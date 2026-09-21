"""Small authenticated integration endpoint for the Cesium smoke-test page."""

from datetime import datetime, timezone

from fastapi import APIRouter

from app.core.dependency import DependAuth
from app.schemas.base import Success

cesium_router = APIRouter(tags=["Cesium 测试"], dependencies=[DependAuth])


@cesium_router.get("/status", summary="Cesium 测试页后端连通状态与示例点位")
async def cesium_status():
    return Success(
        data={
            "status": "ok",
            "framework": "FastAPI",
            "coordinate_system": "WGS84",
            "server_time": datetime.now(timezone.utc).isoformat(),
            "data_mode": "example_locations",
            "locations": [
                {"id": "beijing", "name": "北京", "longitude": 116.4, "latitude": 39.9},
                {"id": "wuhan", "name": "武汉", "longitude": 114.3, "latitude": 30.6},
                {"id": "sanya", "name": "三亚", "longitude": 109.5, "latitude": 18.3},
            ],
        }
    )
