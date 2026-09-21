"""Authenticated volume access; sync routes run generation in FastAPI's worker pool."""

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool
from uuid import UUID

from app.core.dependency import DependAuth
from app.schemas.base import Success
from app.schemas.ionosphere import VolumeMetadataResponse, VolumeResolution, VolumeSource
from app.services.ionosphere import get_volume
from app.services import sami3
from app.services import datasets as dataset_service
from app.models import User
from .datasets import router as dataset_router
from .overview import router as overview_router
from .weather import router as weather_router

ionosphere_router = APIRouter(tags=["三维电离层"], dependencies=[DependAuth])
ionosphere_router.include_router(dataset_router)
ionosphere_router.include_router(overview_router)
ionosphere_router.include_router(weather_router)


@ionosphere_router.get("/sources", summary="可用电离层数据来源")
def volume_sources():
    available = (sami3.DATA_ROOT / "current.json").is_file()
    return Success(
        data={
            "defaultSource": "sami3" if available else "mock",
            "sources": [
                {"id": "mock", "name": "Deterministic Mock · 算法测试", "available": True},
                {"id": "sami3", "name": "SAMI3 · 已导入模型快照", "available": available},
            ],
        }
    )


def select_volume(resolution: VolumeResolution, source: VolumeSource, volume_id: str | None = None):
    if source == "mock":
        volume = get_volume(resolution)
        if volume_id and volume.metadata.id != volume_id:
            raise HTTPException(409, "Mock 数据版本不匹配，请重新加载")
        return volume
    try:
        return sami3.load_imported_volume(resolution, sami3.DATA_ROOT, volume_id, parameter="Ne")
    except FileNotFoundError as error:
        raise HTTPException(503, "SAMI3 快照或指定版本尚未导入，请运行导入脚本") from error
    except (ValueError, KeyError, OSError) as error:
        raise HTTPException(503, "SAMI3 本地数据校验失败，请检查导入文件") from error


@ionosphere_router.get(
    "/volume/metadata",
    response_model=VolumeMetadataResponse,
    response_model_exclude_none=True,
    summary="电离层电子密度体数据元信息",
)
async def volume_metadata(
    resolution: VolumeResolution = "standard",
    source: VolumeSource = "mock",
    importId: UUID | None = None,
    user: User = DependAuth,
):
    if importId and source != "sami3":
        raise HTTPException(422, "导入任务仅适用于SAMI3数据源")
    volume = (
        await dataset_service.selected_volume(importId, resolution, None, user)
        if importId
        else await run_in_threadpool(select_volume, resolution, source)
    )
    return Success(data=volume.metadata.model_dump(exclude_none=True))


@ionosphere_router.get(
    "/volume",
    summary="电离层电子密度 Float32 体数据",
    response_class=Response,
    responses={200: {"content": {"application/octet-stream": {"schema": {"type": "string", "format": "binary"}}}}},
)
async def volume_binary(
    resolution: VolumeResolution = "standard",
    source: VolumeSource = "mock",
    volumeId: str | None = Query(default=None, pattern=r"^[0-9a-f]{64}$"),
    importId: UUID | None = None,
    user: User = DependAuth,
):
    if importId and source != "sami3":
        raise HTTPException(422, "导入任务仅适用于SAMI3数据源")
    volume = (
        await dataset_service.selected_volume(importId, resolution, volumeId, user)
        if importId
        else await run_in_threadpool(select_volume, resolution, source, volumeId)
    )
    return Response(
        content=volume.data,
        media_type="application/octet-stream",
        headers={"ETag": f'"{volume.metadata.id}"', "X-Volume-Id": volume.metadata.id},
    )
