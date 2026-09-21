"""Single-snapshot SAMI3 adapter. No NetCDF access occurs in the HTTP request path.

The original geographic node grid has nonuniform heights and Ne in cm^-3.
Resampling is linear in Ne (not logarithmic), longitude periodic, and never
extrapolates latitude/height or fills missing samples with invented values.
"""

import hashlib
import json
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import netCDF4
import numpy as np

from app.schemas.ionosphere import GridAxis, ValidDomain, VolumeMetadata, VolumeResolution
from app.services.ionosphere import IonosphereVolume
from app.services.ionosphere_parameters import get_parameter, select_parameter

DATA_ROOT = Path(__file__).resolve().parents[2] / "data" / "ionosphere" / "sami3"
SOURCE_URL = "https://zenodo.org/records/8140040"
NODATA = -999.0


@dataclass(frozen=True)
class Snapshot:
    longitude: np.ndarray
    latitude: np.ndarray
    altitude: np.ndarray
    density: np.ndarray  # latitude, longitude, altitude; m^-3
    timestamp: str
    source_file: str
    source_sha256: str
    source_url: str | None = SOURCE_URL
    parameter: str = "Ne"
    source_variable: str = "dene0"
    source_unit: str = "cm-3"


def read_snapshot(path: Path, time_index: int = 0, parameter: str = "Ne", *, allow_empty: bool = False) -> Snapshot:
    """Read exactly one time slab and strictly validate this supported SAMI3 layout."""
    path = Path(path)
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    with netCDF4.Dataset(path, "r") as dataset:
        if not {"time", "lon", "lat", "alt"}.issubset(dataset.variables):
            raise ValueError("文件缺少 SAMI3 time/lon/lat/alt 变量")
        field, entry = select_parameter(dataset, parameter)
        density = dataset[entry["sourceVariable"]]
        if not isinstance(time_index, int) or not 0 <= time_index < density.shape[0]:
            raise ValueError("时间索引超出文件范围")
        factor = field.conversion(entry["sourceUnit"])
        axes = []
        for name, units, dimension in (
            ("lon", ("degrees", "degrees_east"), "nlon"),
            ("lat", ("degrees", "degrees_north"), "nlat"),
            ("alt", ("kilometres", "km", "kilometers"), "nalt"),
        ):
            variable = dataset[name]
            if getattr(variable, "units", "").strip().lower() not in units:
                raise ValueError(f"不支持的 {name} 坐标单位")
            values = np.asarray(np.ma.filled(variable[:], np.nan), dtype=np.float64)
            if variable.dimensions != (dimension,) or values.size < 2 or not np.isfinite(values).all():
                raise ValueError(f"{name} 坐标维度或有限性异常")
            if not np.all(np.diff(values) > 0):
                raise ValueError(f"{name} 坐标必须严格递增")
            axes.append(values)
        lon, lat, alt = axes
        if lat[0] < -90 or lat[-1] > 90 or alt[0] < 0:
            raise ValueError("经纬度或高度超出地理范围")
        # This importer supports full periodic longitude, not a regional patch.
        lon = np.mod(lon, 360)
        order = np.argsort(lon)
        lon = lon[order]
        if not np.allclose(np.diff(np.r_[lon, lon[0] + 360]), 360 / len(lon), atol=1e-6, rtol=0):
            raise ValueError("经度必须是全球周期等间距节点，不包含重复端点")
        if density.shape[1:] != (len(lat), len(lon), len(alt)):
            raise ValueError("参数变量与坐标维数不匹配")
        time_var = dataset["time"]
        if time_var.dimensions != ("nt",):
            raise ValueError("时间维度异常")
        seconds = float(time_var[time_index])
        if not np.isfinite(seconds):
            raise ValueError("时间不是有限数值")
        time_units = getattr(time_var, "units", "").strip()
        if time_units.lower() == "seconds since 0:00 ut 1/1/1970":
            timestamp = datetime.fromtimestamp(seconds, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        else:
            if getattr(time_var, "calendar", "standard") not in ("standard", "gregorian", "proleptic_gregorian"):
                raise ValueError("不支持非公历时间")
            timestamp = netCDF4.num2date(seconds, time_units).strftime("%Y-%m-%dT%H:%M:%SZ")
        # Convert the masked array before filling: integer NetCDF variables
        # cannot represent NaN, but their missing samples must remain missing.
        data = np.ma.asarray(density[time_index, :, :, :], dtype=np.float64).filled(np.nan)
        data = data[:, order, :] * factor
        data[~np.isfinite(data) | ((data <= 0) if field.unit == "K" else (data < 0))] = np.nan
        if not allow_empty and not np.isfinite(data).any():
            raise ValueError(f"所选时刻没有有效{field.name}")
    return Snapshot(
        lon,
        lat,
        alt,
        data,
        timestamp,
        path.name,
        digest.hexdigest(),
        parameter=parameter,
        source_variable=entry["sourceVariable"],
        source_unit=entry["sourceUnit"],
    )


def interpolate(snapshot: Snapshot, longitude: np.ndarray, latitude: np.ndarray, altitude: np.ndarray) -> np.ndarray:
    """Vectorized trilinear interpolation, returning Z/Y/X, longitude fastest."""
    lon = np.r_[snapshot.longitude[-1] - 360, snapshot.longitude, snapshot.longitude[0] + 360]
    data = np.concatenate((snapshot.density[:, -1:, :], snapshot.density, snapshot.density[:, :1, :]), axis=1)

    def bracket(axis, values):
        lower = np.clip(np.searchsorted(axis, values, side="right") - 1, 0, len(axis) - 2)
        fraction = (values - axis[lower]) / (axis[lower + 1] - axis[lower])
        return lower, fraction

    ix, fx = bracket(lon, np.mod(longitude, 360))
    iy, fy = bracket(snapshot.latitude, latitude)
    iz, fz = bracket(snapshot.altitude, altitude)
    shape = (len(altitude), len(latitude), len(longitude))
    result = np.zeros(shape, dtype=np.float64)
    valid = np.broadcast_to(
        ((altitude >= snapshot.altitude[0]) & (altitude <= snapshot.altitude[-1]))[:, None, None]
        & ((latitude >= snapshot.latitude[0]) & (latitude <= snapshot.latitude[-1]))[None, :, None],
        shape,
    ).copy()
    for dz in (0, 1):
        for dy in (0, 1):
            for dx in (0, 1):
                weight = (
                    (fz if dz else 1 - fz)[:, None, None]
                    * (fy if dy else 1 - fy)[None, :, None]
                    * (fx if dx else 1 - fx)[None, None, :]
                )
                samples = data[(iy + dy)[None, :, None], (ix + dx)[None, None, :], (iz + dz)[:, None, None]]
                finite = np.isfinite(samples)
                valid &= finite | (weight == 0)
                result += np.where(finite, samples, 0) * weight
    positive = result > 0 if get_parameter(snapshot.parameter).unit == "K" else result >= 0
    valid &= np.isfinite(result) & positive & (result <= np.finfo(np.float32).max)
    result[~valid] = NODATA
    return result


def resample_snapshot(snapshot: Snapshot, resolution: VolumeResolution) -> IonosphereVolume:
    """Reduce one source slab to the existing bounded, cell-centered GPU grids."""
    dimensions = {"standard": (72, 36, 32), "fine": (144, 72, 64)}
    if resolution not in dimensions:
        raise ValueError("未知网格分辨率")
    low, high = max(90.0, float(snapshot.altitude[0])), min(1000.0, float(snapshot.altitude[-1]))
    if high <= low:
        raise ValueError("文件在90–1000km内没有高度覆盖")
    nx, ny, nz = dimensions[resolution]
    axes = [
        GridAxis(min=lo, max=hi, count=n, step=(hi - lo) / n)
        for lo, hi, n in ((-180, 180, nx), (-90, 90, ny), (low, high, nz))
    ]
    coordinates = [a.min + (np.arange(a.count) + 0.5) * a.step for a in axes]
    values = interpolate(snapshot, *coordinates).astype("<f4")
    finite = values[values != NODATA]
    if not finite.size:
        raise ValueError("重采样后没有有效参数值")
    binary = values.tobytes(order="C")
    field = get_parameter(snapshot.parameter)
    metadata = VolumeMetadata(
        parameter=field.id,
        parameterName=field.name,
        unit=field.unit,
        species=field.species,
        sourceVariable=snapshot.source_variable,
        sourceUnit=snapshot.source_unit,
        defaultNormalization=field.normalization,
        id=hashlib.sha256(binary).hexdigest(),
        longitude=axes[0],
        latitude=axes[1],
        altitude=axes[2],
        minValue=float(finite.min()),
        maxValue=float(finite.max()),
        byteLength=len(binary),
        source="sami3-model",
        sourceName="SAMI3 物理模型",
        timestamp=snapshot.timestamp,
        sourceFile=snapshot.source_file,
        sourceSha256=snapshot.source_sha256,
        sourceUrl=snapshot.source_url,
        noDataValue=NODATA,
        validDomain=ValidDomain(
            latitudeMin=float(snapshot.latitude[0]),
            latitudeMax=float(snapshot.latitude[-1]),
            altitudeMin=low,
            altitudeMax=high,
        ),
    )
    return IonosphereVolume(metadata, binary)


def publish_snapshot(snapshot: Snapshot, output_dir: Path = DATA_ROOT) -> dict:
    """Publish immutable content-addressed artifacts, then atomically switch manifest.

    Existing artifacts are preserved; clients may pin an earlier metadata id while
    a new import is published. No web API accepts a path or writes these files.
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for resolution in ("standard", "fine"):
        volume = resample_snapshot(snapshot, resolution)
        # Include provenance in the version folder while payload id stays SHA256(bytes).
        folder_name = hashlib.sha256(volume.metadata.model_dump_json().encode()).hexdigest()
        folder = output_dir / folder_name
        if not folder.exists():
            staging = output_dir / (".import-" + uuid.uuid4().hex)
            staging.mkdir()
            (staging / "volume.bin").write_bytes(volume.data)
            (staging / "metadata.json").write_text(volume.metadata.model_dump_json(exclude_none=True), encoding="utf-8")
            staging.rename(folder)
        manifest[resolution] = folder_name
    temporary = output_dir / (".manifest-" + uuid.uuid4().hex)
    temporary.write_text(json.dumps(manifest), encoding="utf-8")
    temporary.replace(output_dir / "current.json")
    return manifest


def load_imported_volume(
    resolution: VolumeResolution,
    output_dir: Path = DATA_ROOT,
    volume_id: str | None = None,
    parameter: str | None = None,
) -> IonosphereVolume:
    """Read and verify a small published payload; never trust arbitrary path input."""
    if resolution not in ("standard", "fine"):
        raise ValueError("未知网格分辨率")
    if parameter is not None:
        get_parameter(parameter)
    if volume_id is not None and not re.fullmatch(r"[0-9a-f]{64}", volume_id):
        raise ValueError("无效的体数据标识")
    root = Path(output_dir)
    manifest = json.loads((root / "current.json").read_text(encoding="utf-8"))
    folder_name = manifest[resolution]
    if not isinstance(folder_name, str) or not re.fullmatch(r"[0-9a-f]{64}", folder_name):
        raise ValueError("数据清单异常")
    candidates = [root / folder_name]
    if volume_id:
        candidates += [p for p in root.iterdir() if re.fullmatch(r"[0-9a-f]{64}", p.name) and p.name != folder_name]
    for folder in candidates:
        metadata = VolumeMetadata.model_validate_json((folder / "metadata.json").read_text(encoding="utf-8"))
        if volume_id and metadata.id != volume_id:
            continue
        if parameter is not None and metadata.parameter != parameter:
            continue
        expected = (72, 36, 32) if resolution == "standard" else (144, 72, 64)
        if (metadata.longitude.count, metadata.latitude.count, metadata.altitude.count) != expected:
            continue
        binary = (folder / "volume.bin").read_bytes()
        if len(binary) != metadata.byteLength or hashlib.sha256(binary).hexdigest() != metadata.id:
            raise ValueError("本地体数据文件校验失败，请重新导入")
        if metadata.source != "sami3-model":
            raise ValueError("本地数据来源不匹配")
        return IonosphereVolume(metadata, binary)
    raise FileNotFoundError("指定的 SAMI3 体数据版本不存在")
