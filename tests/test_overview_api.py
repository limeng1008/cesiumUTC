"""Read-only overview frames use real temporary NetCDF and an in-memory database."""

import asyncio
import hashlib
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import httpx
import jwt
import numpy as np
from tortoise import Tortoise

from app import create_app
from app.models import AuditLog, User
from app.models.ionosphere import IonosphereDataset, IonosphereImport
from app.services import datasets
from app.settings import settings
from test_sami3 import write_fixture


class OverviewApiTests(unittest.IsolatedAsyncioTestCase):
    async def test_overview_rejects_non_ne_and_temperature_only_dataset(self):
        data, _ = await self.fixture()
        response = await self.client.get(
            "/api/v1/ionosphere/overview/frame",
            params={"datasetId": str(data.id), "parameter": "Te"},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 422)
        data.preview["parameters"] = [{"parameter": "Te", "available": True}]
        await data.save()
        response = await self.frame(data)
        self.assertEqual(response.status_code, 409)

    async def asyncSetUp(self):
        await Tortoise.init(db_url="sqlite://:memory:", modules={"models": ["app.models"]})
        await Tortoise.generate_schemas()
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.storage = patch.object(datasets, "DATA_ROOT", self.root)
        self.storage.start()
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=create_app()), base_url="http://test")
        self.owner = await User.create(username="owner", email="owner@example.invalid")
        self.other = await User.create(username="other", email="other@example.invalid")
        self.headers = self.auth(self.owner)

    def auth(self, user):
        return {
            "token": jwt.encode(
                {"user_id": user.id, "exp": datetime.now(timezone.utc) + timedelta(minutes=5)},
                settings.SECRET_KEY,
                algorithm=settings.JWT_ALGORITHM,
            )
        }

    async def asyncTearDown(self):
        try:
            from app.services import overview
        except ImportError:
            overview = None
        if overview:
            if overview._pending:
                await asyncio.gather(*overview._pending.values(), return_exceptions=True)
            overview._cache.clear()
        self.storage.stop()
        await self.client.aclose()
        await Tortoise.close_connections()
        self.temp.cleanup()

    async def fixture(self, missing=False):
        data = await IonosphereDataset.create(
            owner=self.owner,
            name="real-upload",
            original_name="real-upload.nc",
            byte_size=0,
            sha256="",
        )
        folder = datasets.dataset_root(data.id)
        folder.mkdir()
        path = folder / "source.nc"
        write_fixture(path, missing=missing)
        from app.services.dataset_worker import inspect_file

        data.sha256 = hashlib.sha256(path.read_bytes()).hexdigest()
        data.byte_size = path.stat().st_size
        data.preview = await datasets.worker(inspect_file, str(path))
        data.status = "preview"
        await data.save()
        return data, path

    async def frame(self, data, index=0, headers=None):
        return await self.client.get(
            "/api/v1/ionosphere/overview/frame",
            params={"datasetId": str(data.id), "timeIndex": index},
            headers=self.headers if headers is None else headers,
        )

    async def test_two_real_times_standard_grid_provenance_and_no_import_or_disk_write(self):
        data, _ = await self.fixture()
        before = {str(p): (p.stat().st_size, p.stat().st_mtime_ns) for p in self.root.rglob("*")}
        frames = []
        for index in (0, 1):
            response = await self.frame(data, index)
            self.assertEqual(response.status_code, 200, response.text[:300])
            frame = response.json()["data"]
            frames.append(frame)
            self.assertEqual(frame["datasetId"], str(data.id))
            self.assertEqual(frame["timeIndex"], index)
            metadata = frame["metadata"]
            self.assertEqual([metadata[a]["count"] for a in ("longitude", "latitude", "altitude")], [72, 36, 32])
            self.assertEqual(len(frame["values"]), 72 * 36 * 32)
            self.assertEqual(metadata["sourceFile"], "real-upload.nc")
            self.assertEqual(metadata["sourceSha256"], data.sha256)
            self.assertNotIn("sourceUrl", metadata)
            self.assertEqual(metadata["timestamp"], data.preview["times"][index]["timestamp"])
            self.assertEqual(
                hashlib.sha256(np.array(frame["values"], dtype="<f4").tobytes()).hexdigest(), metadata["id"]
            )
        np.testing.assert_allclose(np.array(frames[1]["values"]), 2 * np.array(frames[0]["values"]), rtol=1e-6)
        self.assertEqual(await IonosphereImport.all().count(), 0)
        self.assertEqual(await AuditLog.filter(path="/api/v1/ionosphere/overview/frame").count(), 0)
        self.assertEqual(before, {str(p): (p.stat().st_size, p.stat().st_mtime_ns) for p in self.root.rglob("*")})

    async def test_owner_checked_before_hot_cache_and_validation(self):
        data, _ = await self.fixture()
        self.assertEqual((await self.frame(data)).status_code, 200)
        self.assertEqual((await self.frame(data, headers=self.auth(self.other))).status_code, 404)
        self.assertEqual((await self.frame(data, headers={})).status_code, 422)
        await IonosphereDataset.filter(id=data.id).update(status="failed")
        self.assertEqual((await self.frame(data)).status_code, 409)
        await IonosphereDataset.filter(id=data.id).update(status="preview", preview=None)
        self.assertEqual((await self.frame(data)).status_code, 409)

    async def test_indices_are_rejected_before_worker(self):
        data, _ = await self.fixture()
        with patch.object(datasets, "worker", side_effect=AssertionError("invalid index reached worker")):
            for index in (-1, 2, "1.5", "bad"):
                response = await self.frame(data, index)
                self.assertEqual(response.status_code, 422, response.text)

    async def test_missing_samples_remain_finite_nodata(self):
        data, _ = await self.fixture(missing=True)
        response = await self.frame(data)
        self.assertEqual(response.status_code, 200, response.text[:300])
        frame = response.json()["data"]
        self.assertEqual(frame["metadata"]["noDataValue"], -999)
        self.assertIn(-999, frame["values"])
        self.assertTrue(np.isfinite(frame["values"]).all())

    async def test_cache_distinguishes_dataset_sha_and_time_and_rejects_changed_file(self):
        from app.services import overview

        data, path = await self.fixture()
        second, _ = await self.fixture()
        with patch.object(datasets, "worker", wraps=datasets.worker) as worker:
            for selected, index in ((data, 0), (data, 0), (data, 1), (second, 0)):
                self.assertEqual((await self.frame(selected, index)).status_code, 200)
            self.assertEqual(worker.call_count, 3)
            await IonosphereDataset.filter(id=data.id).update(sha256="f" * 64)
            self.assertEqual((await self.frame(data)).status_code, 503)
            self.assertEqual(worker.call_count, 4)
        self.assertLessEqual(len(overview._cache), 4)
        await IonosphereDataset.filter(id=data.id).update(sha256=data.sha256)
        path.unlink()
        self.assertEqual((await self.frame(data)).status_code, 503)

    async def test_lru_evicts_oldest_frame_and_keeps_recent_hit(self):
        from app.services import overview

        fixtures = [await self.fixture() for _ in range(5)]
        with patch.object(datasets, "worker", wraps=datasets.worker) as worker:
            for data, _ in fixtures:
                self.assertEqual((await self.frame(data)).status_code, 200)
            self.assertEqual(len(overview._cache), 4)
            self.assertEqual((await self.frame(fixtures[-1][0])).status_code, 200)
            self.assertEqual(worker.call_count, 5)
            self.assertEqual((await self.frame(fixtures[0][0])).status_code, 200)
            self.assertEqual(worker.call_count, 6)
            self.assertEqual(len(overview._cache), 4)

    async def test_corrupt_source_invalidates_hot_frame_and_inactive_owner_cannot_read(self):
        import netCDF4

        data, path = await self.fixture()
        self.assertEqual((await self.frame(data)).status_code, 200)
        with netCDF4.Dataset(path, "a") as source:
            source["dene0"].units = "corrupted"
        response = await self.frame(data)
        self.assertEqual(response.status_code, 503, response.text)
        self.assertEqual(await IonosphereImport.all().count(), 0)
        await User.filter(id=self.owner.id).update(is_active=False)
        self.assertEqual((await self.frame(data)).status_code, 403)

    async def test_same_frame_is_shared_cancellation_safe_and_distinct_queue_bounded(self):
        from app.services import overview

        data, _ = await self.fixture()
        entered, release = asyncio.Event(), asyncio.Event()
        original_worker = datasets.worker

        async def delayed_worker(*args):
            entered.set()
            await release.wait()
            return await original_worker(*args)

        with (
            patch.object(datasets, "worker", side_effect=delayed_worker) as worker,
            patch.object(overview, "MAX_PENDING_FRAMES", 1),
        ):
            first = asyncio.create_task(overview.selected_frame(data.id, 0, self.owner))
            await asyncio.wait_for(entered.wait(), 5)
            second = asyncio.create_task(overview.selected_frame(data.id, 0, self.owner))
            first.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await first
            rejected = await self.frame(data, 1)
            self.assertEqual(rejected.status_code, 429, rejected.text)
            release.set()
            result = await asyncio.wait_for(second, 10)
            self.assertEqual(result["timeIndex"], 0)
            self.assertEqual(worker.call_count, 1)
        self.assertFalse(overview._pending)


if __name__ == "__main__":
    unittest.main()
