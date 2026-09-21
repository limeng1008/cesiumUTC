"""Executed in one isolated worker process; never opens unbounded full time arrays."""

from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path

import netCDF4
import numpy as np

from app.services import sami3
from app.services.ionosphere_parameters import inspect_parameters

MAX_SLAB_CELLS = 8_000_000
MAX_TIMES = 4096


def preflight(path: Path) -> dict:
    with path.open("rb") as file:
        magic = file.read(8)
    if not (magic.startswith(b"CDF") or magic == b"\x89HDF\r\n\x1a\n"):
        raise ValueError("不是 NetCDF 文件，请上传 SAMI3 NetCDF 数据")
    with netCDF4.Dataset(path, "r") as source:
        if not {"time", "lon", "lat", "alt"}.issubset(source.variables):
            raise ValueError("仅支持含 time/lon/lat/alt 的 SAMI3 文件")
        parameters = inspect_parameters(source)
        nt, ny, nx, nz = (source[name].size for name in ("time", "lat", "lon", "alt"))
        if min(nx, ny, nz) < 2:
            raise ValueError("每个空间坐标轴至少2个点，不能包含空维度")
        if not 1 <= nt <= MAX_TIMES or nx * ny * nz > MAX_SLAB_CELLS:
            raise ValueError("文件维度超过本版上限：4096时刻、单时刻800万格")
        for name, dimension, count in (
            ("time", "nt", nt),
            ("lon", "nlon", nx),
            ("lat", "nlat", ny),
            ("alt", "nalt", nz),
        ):
            if source[name].dimensions != (dimension,) or source[name].shape != (count,):
                raise ValueError(f"{name} 坐标维度不匹配")
        time = source["time"]
        values = np.asarray(np.ma.filled(time[:], np.nan), dtype=float)
        if not np.isfinite(values).all() or (nt > 1 and not np.all(np.diff(values) > 0)):
            raise ValueError("时间必须有限且严格递增")
        units = getattr(time, "units", "")
        if getattr(time, "calendar", "standard") not in ("standard", "gregorian", "proleptic_gregorian"):
            raise ValueError("不支持非公历时间")
        if units.lower().strip() == "seconds since 0:00 ut 1/1/1970":
            times = [datetime.fromtimestamp(float(v), timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") for v in values]
        else:
            times = [v.strftime("%Y-%m-%dT%H:%M:%SZ") for v in netCDF4.num2date(values, units)]
        preferred = next((p for p in parameters if p["parameter"] == "Ne"), None)
        preferred = preferred or next((p for p in parameters if p["available"]), None)
        return {
            "variable": preferred["sourceVariable"] if preferred else "",
            "units": preferred["sourceUnit"] if preferred else "",
            "outputUnits": preferred["unit"] if preferred else "m^-3",
            "parameters": parameters,
            "timeCount": nt,
            "times": [{"index": i, "timestamp": t} for i, t in enumerate(times)],
            "dimensions": {"longitude": nx, "latitude": ny, "altitude": nz},
        }


def inspect_file(path: str) -> dict:
    preview = preflight(Path(path))
    # Reuse strict coordinate/unit checks and validate the first time slab, not the entire 4D field.
    snapshot = None
    for entry in preview["parameters"]:
        if not entry["available"]:
            continue
        try:
            candidate = sami3.read_snapshot(Path(path), 0, entry["parameter"], allow_empty=True)
            entry["firstTimeValid"] = bool(np.isfinite(candidate.density).any())
            if not entry["firstTimeValid"]:
                entry["validationNote"] = "首时刻无有效值；仍可选择其他时刻，导入时分别校验"
            snapshot = snapshot or candidate
        except ValueError as error:
            entry.update(available=False, reason=str(error))
    if snapshot is None:
        # Keep inspectable unsupported fields visible. Validate geometry with no
        # scalar read by reporting coordinate bounds; imports remain disabled.
        with netCDF4.Dataset(path, "r") as source:
            preview["bounds"] = {
                name: [float(source[axis][0]), float(source[axis][-1])]
                for name, axis in (("longitude", "lon"), ("latitude", "lat"), ("altitude", "alt"))
            }
        preview["validationNote"] = "未发现可导入参数；请查看各变量的不可用原因"
        return preview
    if min(1000, snapshot.altitude[-1]) <= max(90, snapshot.altitude[0]):
        raise ValueError("文件在90–1000km内没有高度覆盖")
    preview["bounds"] = {
        name: [float(axis[0]), float(axis[-1])]
        for name, axis in (
            ("longitude", snapshot.longitude),
            ("latitude", snapshot.latitude),
            ("altitude", snapshot.altitude),
        )
    }
    preview["validationNote"] = "已校验结构、单位、坐标；首时刻有效性仅作提示，各时刻在导入时分别校验"
    return preview


def import_file(
    path: str, original_name: str, time_index: int, destination: str, expected_hash: str, parameter: str = "Ne"
) -> None:
    preflight(Path(path))
    snapshot = sami3.read_snapshot(Path(path), time_index, parameter)
    if snapshot.source_sha256 != expected_hash:
        raise ValueError("原始文件校验失败，请重新上传")
    snapshot = replace(snapshot, source_file=original_name, source_url=None)
    sami3.publish_snapshot(snapshot, Path(destination))
