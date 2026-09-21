"""Deterministic mock Ne field. This is a visual test model, not observational data.

Axis bounds describe cell boundaries; samples lie at min + (index + 0.5) * step.
Packing matches a WebGL 3D texture: z * ny * nx + y * nx + x, longitude fastest.
"""

import hashlib
import math
import sys
from array import array
from dataclasses import dataclass
from functools import lru_cache

from app.schemas.ionosphere import GridAxis, VolumeMetadata, VolumeResolution


@dataclass(frozen=True)
class IonosphereVolume:
    metadata: VolumeMetadata
    data: bytes


def electron_density(longitude: float, latitude: float, altitude: float) -> float:
    """Electron density in m^-3 at degrees longitude/latitude and km altitude.

    E (110 km), F1 (190 km), and F2 (260–340 km) are smooth Gaussian layers.
    F2 has a broader topside. Integer longitude harmonics join at the dateline;
    their amplitude vanishes at the poles so the field is continuous globally.
    """
    lon = math.radians(longitude)
    lat = math.radians(latitude)
    latitude_cosine = math.cos(lat)
    modulation = 1.0 + 0.12 * math.cos(lon) * latitude_cosine + 0.04 * math.sin(2 * lon) * latitude_cosine**2
    e_layer = 8.0e10 * math.exp(-0.5 * ((altitude - 110.0) / 10.0) ** 2)
    f1_layer = 1.4e11 * math.exp(-0.5 * ((altitude - 190.0) / 24.0) ** 2)
    f2_peak = 300.0 + 40.0 * math.sin(lat)
    f2_width = 38.0 if altitude < f2_peak else 110.0
    f2_layer = 8.0e11 * (0.8 + 0.2 * latitude_cosine**2) * math.exp(-0.5 * ((altitude - f2_peak) / f2_width) ** 2)
    return 1.0e8 + modulation * (e_layer + f1_layer + f2_layer)


@lru_cache(maxsize=2)
def get_volume(resolution: VolumeResolution = "standard") -> IonosphereVolume:
    """Build at most two cached immutable payloads using only the Python stdlib."""
    dimensions = {"standard": (72, 36, 32), "fine": (144, 72, 64)}
    if resolution not in dimensions:
        raise ValueError(f"Unsupported ionosphere volume resolution: {resolution}")
    nx, ny, nz = dimensions[resolution]
    longitude = GridAxis(min=-180, max=180, count=nx, step=360 / nx)
    latitude = GridAxis(min=-90, max=90, count=ny, step=180 / ny)
    altitude = GridAxis(min=80, max=1000, count=nz, step=920 / nz)

    values = array(
        "f",
        (
            electron_density(
                longitude.min + (x + 0.5) * longitude.step,
                latitude.min + (y + 0.5) * latitude.step,
                altitude.min + (z + 0.5) * altitude.step,
            )
            for z in range(nz)
            for y in range(ny)
            for x in range(nx)
        ),
    )
    if values.itemsize != 4:
        raise RuntimeError("This platform does not provide 32-bit C floats")
    # Read extrema after quantizing to Float32, before any platform byte swap.
    min_value, max_value = min(values), max(values)
    if sys.byteorder != "little":
        values.byteswap()
    data = values.tobytes()
    metadata = VolumeMetadata(
        id=hashlib.sha256(data).hexdigest(),
        longitude=longitude,
        latitude=latitude,
        altitude=altitude,
        minValue=min_value,
        maxValue=max_value,
        byteLength=len(data),
    )
    return IonosphereVolume(metadata=metadata, data=data)
