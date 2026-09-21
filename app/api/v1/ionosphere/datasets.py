"""Authenticated dataset workflow. UUIDs select server-owned paths, never client paths."""

from uuid import UUID
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from app.core.dependency import DependAuth
from app.models import User
from app.models.ionosphere import IonosphereDataset
from app.schemas.base import Success
from app.services import datasets
from app.services.ionosphere_parameters import ParameterId

router = APIRouter()


class ImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    timeIndex: int = Field(ge=0, strict=True)
    parameter: ParameterId = "Ne"


class BatchImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    timeIndices: list[Annotated[int, Field(ge=0, strict=True)]] = Field(min_length=1, max_length=256)
    parameter: ParameterId = "Ne"


@router.post("/datasets/upload", summary="上传SAMI3文件并异步解析")
async def upload_dataset(
    request: Request, filename: str = Query(min_length=1, max_length=255), user: User = DependAuth
):
    dataset = await datasets.upload(request, filename, user)
    return Success(data=await datasets.dataset_json(dataset))


@router.get("/datasets", summary="数据集列表")
async def list_datasets(page: int = Query(1, ge=1), pageSize: int = Query(20, ge=1, le=100), user: User = DependAuth):
    if not user.is_active:
        raise HTTPException(403, "账号已停用")
    query = IonosphereDataset.all()
    if not user.is_superuser:
        query = query.filter(owner_id=user.id)
    total = await query.count()
    rows = await query.order_by("-created_at").offset((page - 1) * pageSize).limit(pageSize)
    return Success(
        data={
            "items": [await datasets.dataset_json(row, include_preview=False) for row in rows],
            "total": total,
            "page": page,
            "pageSize": pageSize,
        }
    )


@router.get("/datasets/{dataset_id}", summary="数据集元信息和导入任务")
async def dataset_detail(dataset_id: UUID, user: User = DependAuth):
    return Success(data=await datasets.dataset_json(await datasets.owned_dataset(dataset_id, user)))


@router.post("/datasets/{dataset_id}/inspect", summary="重试文件解析")
async def retry_inspect(dataset_id: UUID, user: User = DependAuth):
    data = await datasets.owned_dataset(dataset_id, user)
    if data.status in ("failed", "preview"):
        datasets.ensure_capacity()
        changed = await IonosphereDataset.filter(id=data.id, status=data.status).update(status="inspecting", error="")
        if changed:
            datasets.schedule(datasets.inspect_dataset(data.id))
            await data.refresh_from_db()
    return Success(data=await datasets.dataset_json(data))


@router.post("/datasets/{dataset_id}/imports", summary="按时刻导入或重试")
async def start_import(dataset_id: UUID, body: ImportRequest, user: User = DependAuth):
    data = await datasets.owned_dataset(dataset_id, user)
    result = await datasets.submit_imports(data, [body.timeIndex], body.parameter)
    return Success(data=result["tasks"][0])


@router.post("/datasets/{dataset_id}/imports/batch", summary="批量时刻入库，跳过成功与正在处理的任务")
async def batch_import(dataset_id: UUID, body: BatchImportRequest, user: User = DependAuth):
    data = await datasets.owned_dataset(dataset_id, user)
    return Success(data=await datasets.submit_imports(data, body.timeIndices, body.parameter))


@router.post("/datasets/{dataset_id}/imports/cancel", summary="取消指定时刻中尚未执行的任务")
async def cancel_import(dataset_id: UUID, body: BatchImportRequest, user: User = DependAuth):
    data = await datasets.owned_dataset(dataset_id, user)
    return Success(data=await datasets.cancel_imports(data, body.timeIndices, body.parameter))
