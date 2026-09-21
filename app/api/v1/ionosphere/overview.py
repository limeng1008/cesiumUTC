"""Authenticated read-only overview frame API."""

from uuid import UUID
from typing import Literal

from fastapi import APIRouter, Query

from app.core.dependency import DependAuth
from app.models import User
from app.schemas.base import Success
from app.services.overview import selected_frame

router = APIRouter()


@router.get("/overview/frame", summary="读取数据集单时刻标准网格概览")
async def overview_frame(
    datasetId: UUID, timeIndex: int = Query(0, ge=0), parameter: Literal["Ne"] = "Ne", user: User = DependAuth
):
    return Success(data=await selected_frame(datasetId, timeIndex, user))
