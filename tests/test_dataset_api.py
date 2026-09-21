"""Actual HTTP/SQLite/NetCDF integration, with storage confined to a temporary directory."""

import hashlib
import asyncio
import tempfile
import unittest
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import httpx
import jwt
from tortoise import Tortoise

from app import create_app
from app.models import User
from app.settings import settings
from test_sami3 import write_fixture

try:
    from app.services import datasets
except ImportError:
    datasets = None


class DatasetApiTests(unittest.IsolatedAsyncioTestCase):
    async def test_later_temperature_time_can_import_when_first_time_is_empty(self):
        import netCDF4
        from test_ionosphere_parameters import add_parameters

        add_parameters(self.path)
        with netCDF4.Dataset(self.path, "a") as source:
            source["te"][0] = 0
        data = await self.upload()
        await self.detail(data["id"])
        response = await self.client.post(
            f"/api/v1/ionosphere/datasets/{data['id']}/imports",
            json={"timeIndex": 1, "parameter": "Te"},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200, response.text)
        final = await self.detail(data["id"])
        self.assertEqual(final["imports"][0]["status"], "ready", final)

    async def test_parameter_tasks_coexist_cancel_retry_and_protect_artifact_identity(self):
        from test_ionosphere_parameters import add_parameters
        from app.models.ionosphere import IonosphereImport

        add_parameters(self.path)
        data = await self.upload()
        await self.detail(data["id"])
        base = f"/api/v1/ionosphere/datasets/{data['id']}/imports"
        with patch.object(datasets, "kick_queue"):
            ne = await self.client.post(base, json={"timeIndex": 0}, headers=self.headers)
            te = await self.client.post(base, json={"timeIndex": 0, "parameter": "Te"}, headers=self.headers)
            self.assertEqual(te.status_code, 200, te.text)
            self.assertNotEqual(ne.json()["data"]["id"], te.json()["data"]["id"])
            self.assertEqual(te.json()["data"]["parameter"], "Te")
            cancelled = await self.client.post(
                base + "/cancel", json={"timeIndices": [0], "parameter": "Te"}, headers=self.headers
            )
            self.assertEqual(cancelled.json()["data"]["cancelled"], 1)
            self.assertEqual((await IonosphereImport.get(id=ne.json()["data"]["id"])).status, "queued")
            retry = await self.client.post(base, json={"timeIndex": 0, "parameter": "Te"}, headers=self.headers)
            self.assertEqual(retry.json()["data"]["id"], te.json()["data"]["id"])
            denied = await self.client.post(base, json={"timeIndex": 0, "parameter": "Te"}, headers=self.other)
            self.assertEqual(denied.status_code, 404)
            for parameter in ("TEC", "Ni_H+"):
                invalid = await self.client.post(
                    base, json={"timeIndex": 0, "parameter": parameter}, headers=self.headers
                )
                self.assertEqual(invalid.status_code, 422)
        datasets.kick_queue()
        await datasets.wait_jobs()
        query = {"source": "sami3", "importId": te.json()["data"]["id"]}
        meta = await self.client.get("/api/v1/ionosphere/volume/metadata", params=query, headers=self.headers)
        self.assertEqual(meta.status_code, 200, meta.text)
        self.assertEqual(meta.json()["data"]["unit"], "K")
        binary = await self.client.get(
            "/api/v1/ionosphere/volume",
            params={**query, "volumeId": meta.json()["data"]["id"]},
            headers=self.headers,
        )
        self.assertEqual(binary.status_code, 200)
        self.assertEqual(hashlib.sha256(binary.content).hexdigest(), meta.json()["data"]["id"])
        denied_binary = await self.client.get("/api/v1/ionosphere/volume", params=query, headers=self.other)
        self.assertEqual(denied_binary.status_code, 404)
        await IonosphereImport.filter(id=te.json()["data"]["id"]).update(parameter="Ti")
        corrupted = await self.client.get("/api/v1/ionosphere/volume/metadata", params=query, headers=self.headers)
        self.assertNotEqual(corrupted.status_code, 200)

    async def test_explicit_preview_refresh_preserves_previous_preview_when_refresh_fails(self):
        from app.models.ionosphere import IonosphereDataset

        data = await self.upload()
        original = await self.detail(data["id"])

        async def failed_worker(*args):
            raise ValueError("刷新失败")

        with patch.object(datasets, "worker", failed_worker):
            refresh = await self.client.post(f"/api/v1/ionosphere/datasets/{data['id']}/inspect", headers=self.headers)
            self.assertEqual(refresh.status_code, 200)
            await datasets.wait_jobs()
        refreshed = await IonosphereDataset.get(id=data["id"])
        self.assertEqual(refreshed.status, "preview")
        self.assertEqual(refreshed.preview, original["preview"])
        self.assertEqual(refreshed.error, "刷新失败")

    async def asyncSetUp(self):
        await Tortoise.init(db_url="sqlite://:memory:", modules={"models": ["app.models"]})
        await Tortoise.generate_schemas()
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.path = self.root / "fixture.nc"
        write_fixture(self.path)
        if datasets:
            self.storage = patch.object(datasets, "DATA_ROOT", self.root / "managed")
            self.storage.start()
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=create_app()), base_url="http://test")
        self.headers = await self.user_headers("owner")
        self.other = await self.user_headers("other")

    async def user_headers(self, name):
        user = await User.create(username=name, email=f"{name}@example.invalid")
        return {
            "token": jwt.encode(
                {"user_id": user.id, "exp": datetime.now(timezone.utc) + timedelta(minutes=5)},
                settings.SECRET_KEY,
                algorithm=settings.JWT_ALGORITHM,
            )
        }

    async def asyncTearDown(self):
        if datasets:
            await datasets.wait_jobs()
            self.storage.stop()
        await self.client.aclose()
        await Tortoise.close_connections()
        self.temp.cleanup()

    async def upload(self, content=None, filename="fixture.nc"):
        response = await self.client.post(
            "/api/v1/ionosphere/datasets/upload",
            params={"filename": filename},
            content=self.path.read_bytes() if content is None else content,
            headers={**self.headers, "content-type": "application/octet-stream"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["data"]

    async def detail(self, dataset_id):
        if datasets:
            await datasets.wait_jobs()
        response = await self.client.get(f"/api/v1/ionosphere/datasets/{dataset_id}", headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["data"]

    async def test_upload_preview_import_and_binary_are_persisted_and_idempotent(self):
        uploaded = await self.upload(filename="content")
        data = await self.detail(uploaded["id"])
        self.assertEqual(data["status"], "preview", data)
        self.assertEqual(data["preview"]["timeCount"], 2)
        self.assertEqual(data["preview"]["units"], "cm-3")
        self.assertEqual(data["sha256"], hashlib.sha256(self.path.read_bytes()).hexdigest())
        self.assertEqual(data["preview"]["times"][1]["timestamp"], "2019-04-25T00:10:00Z")
        task_url = f"/api/v1/ionosphere/datasets/{data['id']}/imports"
        response = await self.client.post(task_url, json={"timeIndex": 1}, headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        task = response.json()["data"]
        data = await self.detail(data["id"])
        self.assertEqual(data["imports"][0]["status"], "ready", data)
        duplicate = await self.client.post(task_url, json={"timeIndex": 1}, headers=self.headers)
        self.assertEqual(duplicate.json()["data"]["id"], task["id"])
        query = {"source": "sami3", "importId": task["id"]}
        meta = await self.client.get("/api/v1/ionosphere/volume/metadata", params=query, headers=self.headers)
        self.assertEqual(meta.status_code, 200, meta.text)
        metadata = meta.json()["data"]
        self.assertEqual(metadata["timestamp"], "2019-04-25T00:10:00Z")
        self.assertEqual(metadata["sourceFile"], "content")
        self.assertNotIn("sourceUrl", metadata)  # uploaded file is not automatically attributed to Zenodo
        binary = await self.client.get(
            "/api/v1/ionosphere/volume", params={**query, "volumeId": metadata["id"]}, headers=self.headers
        )
        self.assertEqual(binary.status_code, 200, binary.text[:50])
        self.assertEqual(hashlib.sha256(binary.content).hexdigest(), metadata["id"])
        self.assertEqual(len(list((self.root / "managed").rglob("volume.bin"))), 2)

    async def test_owner_isolation_for_list_detail_import_and_volume(self):
        data = await self.upload()
        await self.detail(data["id"])
        task = await self.client.post(
            f"/api/v1/ionosphere/datasets/{data['id']}/imports", json={"timeIndex": 0}, headers=self.headers
        )
        await self.detail(data["id"])
        for suffix in (
            f"/datasets/{data['id']}",
            "/volume/metadata?source=sami3&importId=" + task.json()["data"]["id"],
        ):
            r = await self.client.get("/api/v1/ionosphere" + suffix, headers=self.other)
            self.assertEqual(r.status_code, 404, r.text)
        r = await self.client.post(
            f"/api/v1/ionosphere/datasets/{data['id']}/imports", json={"timeIndex": 1}, headers=self.other
        )
        self.assertEqual(r.status_code, 404)
        r = await self.client.get("/api/v1/ionosphere/datasets", headers=self.other)
        self.assertEqual(r.json()["data"]["total"], 0)
        r = await self.client.get("/api/v1/ionosphere/datasets")
        self.assertEqual(r.status_code, 422)

    async def test_invalid_file_failed_preview_and_retry_are_explicit(self):
        data = await self.upload(b"not netcdf")
        data = await self.detail(data["id"])
        self.assertEqual(data["status"], "failed")
        self.assertTrue(data["error"])
        r = await self.client.post(
            f"/api/v1/ionosphere/datasets/{data['id']}/imports", json={"timeIndex": 0}, headers=self.headers
        )
        self.assertEqual(r.status_code, 409)
        r = await self.client.post(f"/api/v1/ionosphere/datasets/{data['id']}/inspect", headers=self.headers)
        self.assertEqual(r.status_code, 200)
        self.assertEqual((await self.detail(data["id"]))["status"], "failed")

    async def test_limits_empty_filename_and_time_index_validation(self):
        self.assertIsNotNone(datasets, "dataset backend is implemented")
        with patch.object(datasets, "MAX_UPLOAD_BYTES", 8):
            r = await self.client.post(
                "/api/v1/ionosphere/datasets/upload?filename=x.nc", content=b"123456789", headers=self.headers
            )
            self.assertEqual(r.status_code, 413, r.text)
        r = await self.client.post(
            "/api/v1/ionosphere/datasets/upload?filename=../x.nc", content=b"123", headers=self.headers
        )
        self.assertEqual(r.status_code, 422)

    async def test_chunked_upload_limit_auth_and_audit_never_buffer_binary(self):
        from app.models.admin import AuditLog

        async def chunks():
            yield b"12345"
            yield b"67890"

        with patch.object(datasets, "MAX_UPLOAD_BYTES", 8):
            response = await self.client.post(
                "/api/v1/ionosphere/datasets/upload?filename=chunk.nc", content=chunks(), headers=self.headers
            )
            self.assertEqual(response.status_code, 413, response.text)
        self.assertFalse(list((self.root / "managed").rglob("source.nc")))
        response = await self.client.post(
            "/api/v1/ionosphere/datasets/upload?filename=unauthorized.nc", content=self.path.read_bytes()
        )
        self.assertEqual(response.status_code, 422)
        data = await self.upload()
        await self.detail(data["id"])
        audit = await AuditLog.filter(path="/api/v1/ionosphere/datasets/upload", status=200).first()
        self.assertEqual(audit.request_args["filename"], "fixture.nc")
        self.assertNotIn("body", audit.request_args)

    async def test_distinct_times_preserve_artifacts_retry_failed_and_recover_interrupted(self):
        from app.models.ionosphere import IonosphereDataset, IonosphereImport

        data = await self.upload()
        await self.detail(data["id"])
        url = f"/api/v1/ionosphere/datasets/{data['id']}/imports"
        responses = await asyncio.gather(
            *[self.client.post(url, json={"timeIndex": 0}, headers=self.headers) for _ in range(2)]
        )
        self.assertTrue(all(r.status_code == 200 for r in responses))
        first = responses[0].json()["data"]["id"]
        self.assertEqual(first, responses[1].json()["data"]["id"])
        await self.detail(data["id"])
        second = await self.client.post(url, json={"timeIndex": 1}, headers=self.headers)
        second_id = second.json()["data"]["id"]
        await self.detail(data["id"])
        metas = []
        for task_id in (first, second_id):
            r = await self.client.get(
                "/api/v1/ionosphere/volume/metadata",
                params={"source": "sami3", "importId": task_id},
                headers=self.headers,
            )
            self.assertEqual(r.status_code, 200, r.text)
            metas.append(r.json()["data"])
        self.assertNotEqual(metas[0]["id"], metas[1]["id"])
        await IonosphereImport.filter(id=second_id).update(status="processing")
        await datasets.recover_interrupted()
        self.assertEqual((await IonosphereImport.get(id=first)).status, "ready")
        self.assertEqual((await IonosphereImport.get(id=second_id)).status, "failed")
        retry = await self.client.post(url, json={"timeIndex": 1}, headers=self.headers)
        self.assertEqual(retry.json()["data"]["id"], second_id)
        await self.detail(data["id"])
        self.assertEqual((await IonosphereImport.get(id=second_id)).status, "ready")
        self.assertEqual(await IonosphereDataset.all().count(), 1)
        r = await self.client.post(
            "/api/v1/ionosphere/datasets/upload?filename=x.nc", content=b"", headers=self.headers
        )
        self.assertEqual(r.status_code, 422)
        data = await self.upload()
        await self.detail(data["id"])
        r = await self.client.post(
            f"/api/v1/ionosphere/datasets/{data['id']}/imports", json={"timeIndex": 2}, headers=self.headers
        )
        self.assertEqual(r.status_code, 422)

    async def test_batch_import_is_atomic_idempotent_and_ready_is_never_rewritten(self):
        from app.models.ionosphere import IonosphereImport

        data = await self.upload()
        await self.detail(data["id"])
        url = f"/api/v1/ionosphere/datasets/{data['id']}/imports/batch"
        bad = await self.client.post(url, json={"timeIndices": [0, 99]}, headers=self.headers)
        self.assertEqual(bad.status_code, 422, bad.text)
        self.assertEqual(await IonosphereImport.all().count(), 0)
        with patch.object(datasets, "kick_queue", create=True):
            response = await self.client.post(url, json={"timeIndices": [1, 0, 1]}, headers=self.headers)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["data"]["queued"], 2)
            duplicate = await self.client.post(url, json={"timeIndices": [0, 1]}, headers=self.headers)
            self.assertEqual(duplicate.json()["data"]["queued"], 0)
            self.assertEqual(duplicate.json()["data"]["skipped"], 2)
        datasets.kick_queue()
        ready = await self.detail(data["id"])
        self.assertTrue(all(t["status"] == "ready" for t in ready["imports"]), ready)
        ids = {t["id"] for t in ready["imports"]}
        again = await self.client.post(url, json={"timeIndices": [0, 1]}, headers=self.headers)
        self.assertEqual(again.json()["data"]["skipped"], 2)
        self.assertEqual({t["id"] for t in again.json()["data"]["tasks"]}, ids)

    async def test_batch_cancel_is_owner_scoped_queued_only_and_retryable(self):
        from app.models.ionosphere import IonosphereImport

        data = await self.upload()
        await self.detail(data["id"])
        base = f"/api/v1/ionosphere/datasets/{data['id']}/imports"
        with patch.object(datasets, "kick_queue", create=True):
            r = await self.client.post(base + "/batch", json={"timeIndices": [0, 1]}, headers=self.headers)
            self.assertEqual(r.status_code, 200, r.text)
            tasks = r.json()["data"]["tasks"]
            await IonosphereImport.filter(id=tasks[0]["id"]).update(status="processing")
            denied = await self.client.post(base + "/cancel", json={"timeIndices": [0, 1]}, headers=self.other)
            self.assertEqual(denied.status_code, 404)
            cancelled = await self.client.post(base + "/cancel", json={"timeIndices": [0, 1]}, headers=self.headers)
            self.assertEqual(cancelled.json()["data"]["cancelled"], 1)
            self.assertEqual((await IonosphereImport.get(id=tasks[0]["id"])).status, "processing")
            self.assertEqual((await IonosphereImport.get(id=tasks[1]["id"])).status, "cancelled")
            await IonosphereImport.filter(id=tasks[0]["id"]).update(status="failed")
            retry = await self.client.post(base + "/batch", json={"timeIndices": [0, 1]}, headers=self.headers)
            self.assertEqual(retry.json()["data"]["queued"], 2)
            self.assertEqual({t["id"] for t in retry.json()["data"]["tasks"]}, {t["id"] for t in tasks})
            await self.client.post(base + "/cancel", json={"timeIndices": [0, 1]}, headers=self.headers)

    async def test_dispatcher_keeps_waiting_imports_queued_and_continues_after_failure(self):
        from app.models.ionosphere import IonosphereImport

        self.assertTrue(hasattr(datasets, "kick_queue"), "persistent queue dispatcher must exist")
        data = await self.upload()
        await self.detail(data["id"])
        started, release = asyncio.Event(), asyncio.Event()
        calls = []

        async def worker(function, *args):
            calls.append(args[2])
            started.set()
            await release.wait()
            raise ValueError("fixture failure")

        with patch.object(datasets, "worker", worker):
            try:
                r = await self.client.post(
                    f"/api/v1/ionosphere/datasets/{data['id']}/imports/batch",
                    json={"timeIndices": [0, 1]},
                    headers=self.headers,
                )
                self.assertEqual(r.status_code, 200, r.text)
                await asyncio.wait_for(started.wait(), 3)
                states = await IonosphereImport.all().order_by("time_index").values_list("status", flat=True)
                self.assertEqual(states, ["processing", "queued"])
            finally:
                release.set()
                await datasets.wait_jobs()
        self.assertEqual(calls, [0, 1])
        self.assertEqual(await IonosphereImport.filter(status="failed").count(), 2)

    async def test_batch_request_limits_are_strict_and_capacity_failure_is_atomic(self):
        from app.models.ionosphere import IonosphereImport

        data = await self.upload()
        await self.detail(data["id"])
        url = f"/api/v1/ionosphere/datasets/{data['id']}/imports/batch"
        for indices in ([], [True], ["0"], list(range(257))):
            r = await self.client.post(url, json={"timeIndices": indices}, headers=self.headers)
            self.assertEqual(r.status_code, 422, r.text)
        with patch.object(datasets, "MAX_QUEUED_IMPORTS", 1, create=True):
            r = await self.client.post(url, json={"timeIndices": [0, 1]}, headers=self.headers)
            self.assertEqual(r.status_code, 429, r.text)
        self.assertEqual(await IonosphereImport.all().count(), 0)

    async def test_restart_preserves_pending_queue_and_never_restarts_cancelled_tasks(self):
        from app.models.ionosphere import IonosphereImport

        data = await self.upload()
        await self.detail(data["id"])
        url = f"/api/v1/ionosphere/datasets/{data['id']}/imports/batch"
        with patch.object(datasets, "kick_queue"):
            await self.client.post(url, json={"timeIndices": [0, 1]}, headers=self.headers)
        tasks = await IonosphereImport.all().order_by("time_index")
        await IonosphereImport.filter(id=tasks[1].id).update(status="cancelled")
        with patch.object(datasets, "kick_queue") as kick:
            await datasets.recover_interrupted()
            kick.assert_called_once()
        self.assertEqual((await IonosphereImport.get(id=tasks[0].id)).status, "queued")
        self.assertEqual((await IonosphereImport.get(id=tasks[1].id)).status, "cancelled")
        datasets.kick_queue()
        await datasets.wait_jobs()
        self.assertEqual((await IonosphereImport.get(id=tasks[0].id)).status, "ready")
        self.assertEqual((await IonosphereImport.get(id=tasks[1].id)).status, "cancelled")


class DatasetPreflightTests(unittest.TestCase):
    def test_wait_jobs_yields_for_completed_job_cleanup(self):
        # A subprocess deadline is necessary: a starved event loop cannot run
        # asyncio.wait_for's timer, so an in-loop timeout would also hang.
        script = """
import asyncio
from app.services import datasets

async def exercise():
    completed = asyncio.Event()
    async def finish():
        completed.set()
    datasets.schedule(finish())
    await completed.wait()
    assert datasets._jobs and all(task.done() for task in datasets._jobs)
    await datasets.wait_jobs()
    assert not datasets._jobs

asyncio.run(exercise())
"""
        try:
            result = subprocess.run(
                [sys.executable, "-c", script],
                cwd=Path(__file__).resolve().parents[1],
                capture_output=True,
                text=True,
                timeout=5,
            )
        except subprocess.TimeoutExpired:
            self.fail("wait_jobs starved the event loop instead of letting completed-job cleanup run")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_empty_spatial_axis_cannot_bypass_memory_limit(self):
        import netCDF4
        from app.services.dataset_worker import preflight

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "empty-axis.nc"
            with netCDF4.Dataset(path, "w") as source:
                for name, size in (("nt", 1), ("nlat", 2), ("nlon", 1_000_000_000), ("nalt", 0)):
                    source.createDimension(name, size)
                for name, dimension in (("time", "nt"), ("lon", "nlon"), ("lat", "nlat"), ("alt", "nalt")):
                    source.createVariable(name, "f4", (dimension,))
                source["time"].units = "seconds since 1970-01-01"
                source["time"][:] = [0]
                source.createVariable("dene0", "f4", ("nt", "nlat", "nlon", "nalt"))
            # Header-only fixture: do not materialize the billion-entry coordinate.
            self.assertLess(path.stat().st_size, 100_000)
            with self.assertRaisesRegex(ValueError, "至少2"):
                preflight(path)


if __name__ == "__main__":
    unittest.main()
