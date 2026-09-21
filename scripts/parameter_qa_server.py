"""Isolated browser QA only: never opens the production database or dataset directory.

Run: python -m scripts.parameter_qa_server --root /absolute/new/qa-directory
The directory must not already exist. Browser may proxy only ionosphere API requests
to 127.0.0.1:19999 for testing, leaving the user's application data untouched.
"""

import argparse
from contextlib import asynccontextmanager
from pathlib import Path

import netCDF4
import numpy as np
import uvicorn
from tortoise import Tortoise

from app import create_app
from app.models import User
from app.services import datasets
from app.utils.password import get_password_hash


def create_fixture(path):
    with netCDF4.Dataset(path, "w") as source:
        lon = np.arange(0, 360, 15)
        lat = np.linspace(-89, 89, 13)
        alt = np.array([90, 100, 150, 200, 300, 400, 600, 1000, 1100])
        for name, size in (("nt", 2), ("nlon", len(lon)), ("nlat", len(lat)), ("nalt", len(alt))):
            source.createDimension(name, size)
        for name, dim, values, unit in (
            ("time", "nt", [1556150400, 1556151000], "Seconds since 0:00 UT 1/1/1970"),
            ("lon", "nlon", lon, "degrees_east"),
            ("lat", "nlat", lat, "degrees_north"),
            ("alt", "nalt", alt, "km"),
        ):
            v = source.createVariable(name, "f8", (dim,))
            v.units = unit
            v[:] = values
        horizontal = (0.4 + 0.6 * np.cos(np.deg2rad(lat[:, None])) ** 2) * (
            0.4 + 0.6 * (1 + np.cos(np.deg2rad(lon[None, :] - 110))) / 2
        )
        density = 5e9 + 1e12 * horizontal[:, :, None] * np.exp(-(((alt[None, None, :] - 300) / 170) ** 2))
        temperature = 650 + 0.8 * alt[None, None, :] + 450 * horizontal[:, :, None]
        for name, values, unit in (
            ("dene0", density / 1e6, "cm-3"),
            ("te", temperature, "K"),
            ("ti0", temperature * 0.7, "K"),
            ("n_oplus", density * 0.8 / 1e6, "cm-3"),
        ):
            v = source.createVariable(name, "f8", ("nt", "nlat", "nlon", "nalt"))
            v.units = unit
            v[0], v[1] = values, values * 1.05
        source.description = "Deterministic synthetic QA fixture, not observations or a validated physical model"


def serve(root):
    root.mkdir(parents=True, exist_ok=False)
    create_fixture(root / "QA_ONLY_synthetic_parameters.nc")
    datasets.DATA_ROOT = root / "managed"
    app = create_app()

    @asynccontextmanager
    async def qa_lifespan(_app):
        await Tortoise.init(db_url=f"sqlite://{root / 'qa.sqlite3'}", modules={"models": ["app.models"]})
        await Tortoise.generate_schemas()
        # The signed-in local admin's user ID is 1; this separate database owns no user data.
        await User.create(
            id=1,
            username="qa-only",
            password=get_password_hash("123456"),
            email="qa@example.invalid",
            is_superuser=True,
            is_active=True,
        )
        try:
            yield
        finally:
            await datasets.stop_worker()
            await Tortoise.close_connections()

    app.router.lifespan_context = qa_lifespan
    uvicorn.run(app, host="127.0.0.1", port=19999, log_level="warning")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=Path)
    args = parser.parse_args()
    serve(args.root.resolve())
