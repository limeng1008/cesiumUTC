"""Read-only single-frame access with bounded in-memory cache and shared jobs."""

import asyncio
from collections import OrderedDict
from dataclasses import replace
from pathlib import Path

import numpy as np
from fastapi import HTTPException
from loguru import logger

from app.services import datasets, sami3
from app.services.dataset_worker import preflight

MAX_CACHED_FRAMES = 4
MAX_PENDING_FRAMES = 2
_cache: OrderedDict[tuple, tuple] = OrderedDict()
_pending: dict[tuple, asyncio.Task] = {}


def source_signature(path: Path) -> tuple:
    """Invalidate a cached immutable frame when the managed source changes."""
    info = path.stat()
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns


def read_frame(path: str, original_name: str, time_index: int, expected_hash: str) -> dict:
    """Runs in the existing isolated process; reads one slab and never publishes."""
    source = Path(path)
    signature = source_signature(source)
    preflight(source)
    snapshot = sami3.read_snapshot(source, time_index)
    if snapshot.source_sha256 != expected_hash or source_signature(source) != signature:
        raise ValueError("原始文件校验失败，请重新上传")
    snapshot = replace(snapshot, source_file=original_name, source_url=None)
    volume = sami3.resample_snapshot(snapshot, "standard")
    values = np.frombuffer(volume.data, dtype="<f4")
    # Keep the existing numeric no-data contract; JSON must never contain NaN/Inf.
    values = np.where(np.isfinite(values), values, sami3.NODATA)
    return {"metadata": volume.metadata.model_dump(exclude_none=True), "values": values.tolist()}


async def _load_frame(key, path, original_name, signature):
    try:
        result = await datasets.worker(read_frame, str(path), original_name, key[2], key[1])
        if await asyncio.to_thread(source_signature, path) != signature:
            raise ValueError("原始文件在读取期间发生变化，请重新上传")
        frame = {"datasetId": key[0], "timeIndex": key[2], **result}
        _cache[key] = (signature, original_name, frame)
        _cache.move_to_end(key)
        while len(_cache) > MAX_CACHED_FRAMES:
            _cache.popitem(last=False)
        return frame
    except Exception as error:
        logger.warning("Overview frame {} failed: {}", key[0], type(error).__name__)
        message = str(error)[:500] if isinstance(error, ValueError) else "原始文件不可用或已损坏，请重新上传并解析"
        raise HTTPException(503, message) from error
    finally:
        _pending.pop(key, None)


def _consume_exception(task):
    # A disconnected last waiter must not leave an unobserved failed shared task.
    if not task.cancelled():
        task.exception()


async def selected_frame(dataset_id, time_index: int, user):
    # This must happen on every request, including a cache hit or joined job.
    data = await datasets.owned_dataset(dataset_id, user)
    if data.status != "preview" or not data.preview:
        raise HTTPException(409, "请等待文件解析成功后再查看")
    parameters = data.preview.get("parameters")
    if parameters is not None and not any(p["parameter"] == "Ne" and p["available"] for p in parameters):
        raise HTTPException(409, "电子密度概览仅支持含可用 Ne 的数据集")
    count = data.preview.get("timeCount")
    if not isinstance(count, int) or count < 1:
        raise HTTPException(409, "数据集预览无效，请重新解析")
    if type(time_index) is not int or not 0 <= time_index < count:
        raise HTTPException(422, "时间索引超出文件范围")
    key = (str(data.id), data.sha256, time_index)
    path = datasets.dataset_root(data.id) / "source.nc"
    try:
        signature = await asyncio.to_thread(source_signature, path)
    except OSError as error:
        _cache.pop(key, None)
        raise HTTPException(503, "原始文件不可用，请重新上传并解析") from error
    cached = _cache.get(key)
    if cached and cached[:2] == (signature, data.original_name):
        _cache.move_to_end(key)
        return cached[2]
    _cache.pop(key, None)
    task = _pending.get(key)
    if task is None:
        if len(_pending) >= MAX_PENDING_FRAMES:
            raise HTTPException(429, "概览帧读取队列已满，请稍后重试")
        task = asyncio.create_task(_load_frame(key, path, data.original_name, signature))
        _pending[key] = task
        task.add_done_callback(_consume_exception)
    # Request cancellation must not cancel work shared by another viewer/waiter.
    return await asyncio.shield(task)
