"""Independent GFZ observed Kp, matched to a model time's three-hour UTC bin.

GFZ endpoint includes both query endpoints; only the exact interval start is used.
No live-value fallback, interpolation, date fallback, or model-derived Kp is allowed.
The activity label describes historical observations, never a forecast.
"""

import asyncio
import math
import time
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx

SOURCE_URL = "https://kp.gfz.de/app/json/"
SOURCE = "GFZ Potsdam · Kp 历史观测 (CC BY 4.0)"
MIN_TIMESTAMP = datetime(1932, 1, 1, tzinfo=timezone.utc)
TOTAL_TIMEOUT = 7.0
MAX_PENDING = 4
MAX_CACHE_ENTRIES = 128
_cache: OrderedDict[str, tuple[float, dict]] = OrderedDict()
_pending: dict[str, asyncio.Task] = {}


def utc_interval(timestamp: datetime) -> tuple[datetime, datetime]:
    if timestamp.tzinfo is None or timestamp.utcoffset() is None:
        raise ValueError("timestamp 必须包含时区")
    timestamp = timestamp.astimezone(timezone.utc)
    if timestamp < MIN_TIMESTAMP or timestamp > datetime.now(timezone.utc):
        raise ValueError("仅支持 1932 年起至当前时刻的历史观测时间")
    start = timestamp.replace(hour=timestamp.hour // 3 * 3, minute=0, second=0, microsecond=0)
    return start, start + timedelta(hours=3)


def _iso(timestamp: datetime) -> str:
    return timestamp.isoformat().replace("+00:00", "Z")


def _base(start: datetime, end: datetime) -> dict:
    params = {"start": _iso(start), "end": _iso(end), "index": "Kp"}
    return {
        "available": False,
        "kp": None,
        "intervalStart": params["start"],
        "intervalEnd": params["end"],
        "level": None,
        "label": "历史观测暂不可用",
        "source": SOURCE,
        "sourceUrl": SOURCE_URL + "?" + urlencode(params),
        "reason": None,
    }


def _classification(kp: float) -> tuple[str, str]:
    if kp < 4:
        return "quiet", "平静 · 历史观测"
    if kp < 5:
        return "active", "活跃 · 历史观测"
    level = f"G{min(int(kp) - 4, 5)}"
    return level, f"{level} 地磁暴等级对应值 · 历史观测，非预测（NOAA Kp 阈值）"


def _parse(payload: object, start: datetime) -> float:
    if not isinstance(payload, dict):
        raise ValueError("GFZ 数据格式异常")
    dates, values = payload.get("datetime"), payload.get("Kp")
    if not isinstance(dates, list) or not isinstance(values, list) or len(dates) != len(values):
        raise ValueError("GFZ 数据格式异常")
    matches = []
    for date, value in zip(dates, values):
        if not isinstance(date, str):
            raise ValueError("GFZ 记录时间格式异常")
        try:
            parsed = datetime.fromisoformat(date.replace("Z", "+00:00"))
        except ValueError as error:
            raise ValueError("GFZ 记录时间格式异常") from error
        if parsed.tzinfo is None:
            raise ValueError("GFZ 记录缺少 UTC 时区")
        if parsed.astimezone(timezone.utc) == start:
            matches.append(value)
    if len(matches) != 1:
        raise ValueError("GFZ 未提供该三小时 UTC 区间的唯一观测记录")
    value = matches[0]
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or not 0 <= value <= 9
    ):
        raise ValueError("GFZ 该区间 Kp 缺测或数值无效")
    return float(value)


async def _fetch(start: datetime, end: datetime) -> float:
    async with httpx.AsyncClient(timeout=6.0, follow_redirects=False) as client:
        response = await client.get(SOURCE_URL, params={"start": _iso(start), "end": _iso(end), "index": "Kp"})
        response.raise_for_status()
        if len(response.content) > 65536:
            raise ValueError("GFZ 响应超出单区间数据上限")
        return _parse(response.json(), start)


async def _load(start: datetime, end: datetime) -> dict:
    key = _iso(start)
    result = _base(start, end)
    try:
        kp = await asyncio.wait_for(_fetch(start, end), timeout=TOTAL_TIMEOUT)
        level, label = _classification(kp)
        result.update(available=True, kp=kp, level=level, label=label)
    except (TimeoutError, httpx.TimeoutException):
        result["reason"] = "GFZ 历史观测请求超时，请稍后重试"
    except httpx.HTTPError:
        result["reason"] = "GFZ 历史观测服务暂不可用，请稍后重试"
    except ValueError as error:
        result["reason"] = str(error)
    finally:
        _pending.pop(key, None)
    _cache[key] = (time.monotonic() + (86400 if result["available"] else 60), result)
    _cache.move_to_end(key)
    while len(_cache) > MAX_CACHE_ENTRIES:
        _cache.popitem(last=False)
    return result


async def get_space_weather(timestamp: datetime) -> dict:
    start, end = utc_interval(timestamp)
    key = _iso(start)
    cached = _cache.get(key)
    if cached and cached[0] > time.monotonic():
        _cache.move_to_end(key)
        return dict(cached[1])
    _cache.pop(key, None)
    task = _pending.get(key)
    if task is None:
        if len(_pending) >= MAX_PENDING:
            result = _base(start, end)
            result["reason"] = "历史观测查询繁忙，请稍后重试"
            return result
        task = asyncio.create_task(_load(start, end))
        _pending[key] = task
    return dict(await asyncio.shield(task))
