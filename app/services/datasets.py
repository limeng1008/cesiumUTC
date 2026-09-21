"""Managed disk storage, persistent import state and a bounded single-process worker."""

import asyncio
import hashlib
import multiprocessing
import uuid
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from tortoise.transactions import in_transaction

from fastapi import HTTPException, Request
from loguru import logger

from app.models.ionosphere import IonosphereDataset, IonosphereImport
from app.services import sami3
from app.services.dataset_worker import import_file, inspect_file
from app.services.ionosphere_parameters import get_parameter

DATA_ROOT = Path(__file__).resolve().parents[2] / "data" / "ionosphere" / "datasets"
MAX_UPLOAD_BYTES = 1024**3
MAX_PENDING_JOBS = 16
MAX_QUEUED_IMPORTS = 512
_executor = None
_jobs: set[asyncio.Task] = set()
_dispatcher = None
_locks = {}


def loop_lock(name):
    """One API process; keep locks associated with their owning event loop."""
    loop = asyncio.get_running_loop()
    if name not in _locks or _locks[name][0] is not loop:
        _locks[name] = (loop, asyncio.Lock())
    return _locks[name][1]


def dataset_root(dataset_id) -> Path:
    return DATA_ROOT / str(uuid.UUID(str(dataset_id)))


def import_root(dataset_id, import_id) -> Path:
    return dataset_root(dataset_id) / "imports" / str(uuid.UUID(str(import_id)))


async def worker(function, *args):
    global _executor
    if _executor is None:
        _executor = ProcessPoolExecutor(max_workers=1, mp_context=multiprocessing.get_context("spawn"))
    return await asyncio.get_running_loop().run_in_executor(_executor, function, *args)


def ensure_capacity():
    if len(_jobs) >= MAX_PENDING_JOBS:
        raise HTTPException(429, "导入队列已满，请稍后重试")


def schedule(coroutine):
    task = asyncio.create_task(coroutine)
    _jobs.add(task)
    task.add_done_callback(_jobs.discard)
    return task


def kick_queue():
    global _dispatcher
    if _dispatcher is None or _dispatcher.done():
        _dispatcher = schedule(drain_imports())


async def drain_imports():
    global _dispatcher
    try:
        while True:
            # Synchronize the empty check with submission so a new job cannot
            # miss its wakeup while the dispatcher is finishing.
            async with loop_lock("queue"):
                task = await IonosphereImport.filter(status="queued").order_by("created_at", "time_index").first()
                if task is None:
                    _dispatcher = None
                    return
            await run_import(task.id)
    finally:
        if _dispatcher is asyncio.current_task():
            _dispatcher = None


def checked_indices(data, indices):
    if data.status != "preview" or not data.preview:
        raise HTTPException(409, "请等待文件解析成功后再导入")
    times = {t["index"]: t["timestamp"] for t in data.preview["times"]}
    ordered = sorted(set(indices))
    if not ordered or len(indices) > 256 or any(i not in times for i in ordered):
        raise HTTPException(422, "时间索引超出文件范围或超过单次256个时刻限制")
    return ordered, times


def checked_parameter(data, parameter):
    try:
        get_parameter(parameter)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    parameters = (data.preview or {}).get("parameters")
    if parameters is None and parameter == "Ne":
        return  # Legacy successful previews implicitly described dene0 only.
    matches = [entry for entry in parameters or [] if entry["parameter"] == parameter]
    if len(matches) != 1 or not matches[0]["available"]:
        raise HTTPException(
            422,
            "所选参数不可导入："
            + (matches[0].get("reason", "别名冲突") if matches else "文件没有该参数，请重新解析确认"),
        )


async def submit_imports(data, indices, parameter="Ne"):
    indices, times = checked_indices(data, indices)
    checked_parameter(data, parameter)
    queued = 0
    async with loop_lock("queue"):
        async with in_transaction():
            existing = {
                t.time_index: t
                for t in await IonosphereImport.filter(dataset_id=data.id, time_index__in=indices, parameter=parameter)
            }
            needed = [i for i in indices if i not in existing or existing[i].status in ("failed", "cancelled")]
            pending = await IonosphereImport.filter(status__in=["queued", "processing"]).count()
            if needed and pending + len(needed) > MAX_QUEUED_IMPORTS:
                raise HTTPException(429, "后台队列容量不足，请缩小批量范围或等待当前任务完成")
            for index in needed:
                task = existing.get(index)
                if task:
                    await IonosphereImport.filter(id=task.id, status__in=["failed", "cancelled"]).update(
                        status="queued", progress=0, error=""
                    )
                else:
                    await IonosphereImport.create(
                        dataset_id=data.id, time_index=index, timestamp=times[index], parameter=parameter
                    )
                queued += 1
            tasks = await IonosphereImport.filter(
                dataset_id=data.id, time_index__in=indices, parameter=parameter
            ).order_by("time_index")
        kick_queue()
    return {"tasks": [task_json(t) for t in tasks], "queued": queued, "skipped": len(indices) - queued}


async def cancel_imports(data, indices, parameter="Ne"):
    indices, _ = checked_indices(data, indices)
    try:
        get_parameter(parameter)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    async with loop_lock("queue"):
        count = await IonosphereImport.filter(
            dataset_id=data.id, time_index__in=indices, parameter=parameter, status="queued"
        ).update(status="cancelled", progress=0, error="用户取消了尚未执行的任务")
        tasks = await IonosphereImport.filter(dataset_id=data.id, time_index__in=indices, parameter=parameter).order_by(
            "time_index"
        )
    return {"tasks": [task_json(t) for t in tasks], "cancelled": count}


async def wait_jobs():
    while _jobs:
        await asyncio.gather(*list(_jobs), return_exceptions=True)
        # gather() can complete synchronously for already-done jobs on Python
        # 3.13. Let their scheduled discard callbacks run before checking again.
        await asyncio.sleep(0)


async def stop_worker():
    global _executor
    await wait_jobs()
    if _executor:
        await asyncio.to_thread(_executor.shutdown, wait=True, cancel_futures=True)
        _executor = None


async def recover_interrupted():
    # Local single-API-process deployment. Never mark a ready immutable artifact as failed.
    await IonosphereDataset.filter(status="inspecting", preview__not_isnull=True).update(
        status="preview", error="服务重启中断了刷新，已保留此前预览，请重新解析"
    )
    await IonosphereDataset.filter(status="inspecting").update(
        status="failed", error="服务重启中断了解析，请点击重新解析"
    )
    await IonosphereImport.filter(status="processing").update(status="failed", error="服务重启中断了导入，请重试")
    if await IonosphereImport.filter(status="queued").exists():
        kick_queue()


def public_error(error):
    return (
        str(error)[:500]
        if isinstance(error, ValueError)
        else "文件解析或存储失败，请检查NetCDF格式、文件完整性和磁盘空间"
    )


async def inspect_dataset(dataset_id):
    async with loop_lock("worker"):
        await _inspect_dataset(dataset_id)


async def _inspect_dataset(dataset_id):
    try:
        preview = await worker(inspect_file, str(dataset_root(dataset_id) / "source.nc"))
        await IonosphereDataset.filter(id=dataset_id, status="inspecting").update(
            status="preview", preview=preview, error=""
        )
    except Exception as error:
        logger.warning("Dataset {} inspection failed: {}", dataset_id, type(error).__name__)
        await IonosphereDataset.filter(id=dataset_id, status="inspecting", preview__not_isnull=True).update(
            status="preview", error=public_error(error)
        )
        await IonosphereDataset.filter(id=dataset_id, status="inspecting").update(
            status="failed", error=public_error(error)
        )


async def run_import(import_id):
    async with loop_lock("worker"):
        await _run_import(import_id)


async def _run_import(import_id):
    task = await IonosphereImport.get(id=import_id).prefetch_related("dataset")
    try:
        changed = await IonosphereImport.filter(id=import_id, status="queued").update(status="processing", progress=20)
        if not changed:
            return
        dataset = task.dataset
        destination = import_root(dataset.id, task.id)
        await worker(
            import_file,
            str(dataset_root(dataset.id) / "source.nc"),
            dataset.original_name,
            task.time_index,
            str(destination),
            dataset.sha256,
            task.parameter,
        )
        await IonosphereImport.filter(id=task.id).update(progress=90)
        for resolution in ("standard", "fine"):
            await asyncio.to_thread(sami3.load_imported_volume, resolution, destination, None, task.parameter)
        await IonosphereImport.filter(id=task.id).update(status="ready", progress=100, error="")
    except Exception as error:
        logger.warning("Import {} failed: {}", import_id, type(error).__name__)
        await IonosphereImport.filter(id=import_id).update(status="failed", error=public_error(error))


async def owned_dataset(dataset_id, user):
    if not user.is_active:
        raise HTTPException(403, "账号已停用")
    query = IonosphereDataset.filter(id=dataset_id)
    if not user.is_superuser:
        query = query.filter(owner_id=user.id)
    data = await query.first()
    if not data:
        raise HTTPException(404, "数据集不存在或无权访问")
    return data


def task_json(task):
    return {
        "id": str(task.id),
        "datasetId": str(task.dataset_id),
        "timeIndex": task.time_index,
        "parameter": task.parameter,
        "timestamp": task.timestamp,
        "status": task.status,
        "progress": task.progress,
        "error": task.error,
        "createdAt": task.created_at.isoformat(),
    }


async def dataset_json(data, include_preview=True):
    tasks = await IonosphereImport.filter(dataset_id=data.id).order_by("-created_at")
    return {
        "id": str(data.id),
        "name": data.name,
        "originalName": data.original_name,
        "byteSize": data.byte_size,
        "sha256": data.sha256,
        "status": data.status,
        "error": data.error,
        "preview": data.preview if include_preview else None,
        "ownerId": data.owner_id,
        "createdAt": data.created_at.isoformat(),
        "imports": [task_json(t) for t in tasks],
    }


async def upload(request: Request, filename: str, user):
    if not user.is_active:
        raise HTTPException(403, "账号已停用")
    ensure_capacity()
    if (
        not filename.strip()
        or len(filename) > 255
        or any(c in filename for c in ("/", "\\", "\x00"))
        or any(ord(c) < 32 for c in filename)
    ):
        raise HTTPException(422, "文件名无效，请使用不含路径的文件名")
    length = request.headers.get("content-length")
    if length and (not length.isdigit() or int(length) > MAX_UPLOAD_BYTES):
        raise HTTPException(413, "文件大小超过1GiB上限")
    dataset_id = uuid.uuid4()
    folder = dataset_root(dataset_id)
    folder.mkdir(parents=True, exist_ok=False)
    target = folder / "source.nc"
    size, digest = 0, hashlib.sha256()
    try:
        with target.open("xb") as output:
            async for chunk in request.stream():
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(413, "文件大小超过1GiB上限")
                digest.update(chunk)
                await asyncio.to_thread(output.write, chunk)
        if not size:
            raise HTTPException(422, "不能上传空文件")
        ensure_capacity()
        data = await IonosphereDataset.create(
            id=dataset_id,
            owner_id=user.id,
            name=filename,
            original_name=filename,
            byte_size=size,
            sha256=digest.hexdigest(),
        )
    except BaseException:
        # Only clean this request's newly created partial file, never existing user data.
        target.unlink(missing_ok=True)
        folder.rmdir()
        raise
    schedule(inspect_dataset(dataset_id))
    return data


async def selected_volume(import_id, resolution, volume_id, user):
    task = await IonosphereImport.filter(id=import_id).first()
    if not task:
        raise HTTPException(404, "导入任务不存在或无权访问")
    await owned_dataset(task.dataset_id, user)
    if task.status != "ready":
        raise HTTPException(409, "该时刻尚未导入完成")
    try:
        return await asyncio.to_thread(
            sami3.load_imported_volume, resolution, import_root(task.dataset_id, task.id), volume_id, task.parameter
        )
    except FileNotFoundError as error:
        raise HTTPException(409, "数据产物或版本不存在，请重新导入") from error
    except (ValueError, KeyError, OSError) as error:
        raise HTTPException(503, "数据产物校验失败，请重新导入") from error
