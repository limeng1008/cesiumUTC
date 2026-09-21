"""Authenticated independent historical Kp for the selected model timestamp."""

from datetime import datetime

from fastapi import APIRouter, HTTPException, Query

from app.core.dependency import DependAuth
from app.schemas.base import Success
from app.services.space_weather import get_space_weather

router = APIRouter(dependencies=[DependAuth])


@router.get("/space-weather", summary="按模型时刻匹配 GFZ 历史 Kp 观测")
async def space_weather(timestamp: str = Query(..., min_length=17, max_length=40, pattern=r"^\d{4}-\d{2}-\d{2}T")):
    try:
        result = await get_space_weather(datetime.fromisoformat(timestamp))
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return Success(data=result)
