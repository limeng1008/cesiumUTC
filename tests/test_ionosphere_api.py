"""Authenticated volume contract against the actual middleware and router stack."""

import hashlib
import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch
from datetime import datetime, timedelta, timezone

import httpx
import jwt
from tortoise import Tortoise

from app import create_app
from app.models import User
from app.models.admin import AuditLog
from app.settings import settings
from app.services import sami3
from test_sami3 import write_fixture


class IonosphereApiTests(unittest.IsolatedAsyncioTestCase):
    async def test_legacy_source_ne_endpoint_cannot_serve_temperature_snapshot(self):
        from test_ionosphere_parameters import add_parameters

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = root / "source.nc"
            write_fixture(path)
            add_parameters(path)
            sami3.publish_snapshot(sami3.read_snapshot(path, parameter="Te"), root / "data")
            with patch.object(sami3, "DATA_ROOT", root / "data"):
                response = await self.client.get(
                    "/api/v1/ionosphere/volume/metadata", params={"source": "sami3"}, headers=self.headers
                )
                self.assertEqual(response.status_code, 503)

    async def asyncSetUp(self):
        await Tortoise.init(db_url="sqlite://:memory:", modules={"models": ["app.models"]})
        await Tortoise.generate_schemas()
        user = await User.create(username="volume-test", email="volume@example.invalid")
        token = jwt.encode(
            {"user_id": user.id, "exp": datetime.now(timezone.utc) + timedelta(minutes=5)},
            settings.SECRET_KEY,
            algorithm=settings.JWT_ALGORITHM,
        )
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=create_app()), base_url="http://test")
        self.headers = {"token": token}

    async def asyncTearDown(self):
        await self.client.aclose()
        await Tortoise.close_connections()

    async def test_metadata_and_binary_share_content_identity_for_both_resolutions(self):
        for resolution, count in (("standard", 72 * 36 * 32), ("fine", 144 * 72 * 64)):
            with self.subTest(resolution=resolution):
                params = {"resolution": resolution}
                meta_response = await self.client.get(
                    "/api/v1/ionosphere/volume/metadata", params=params, headers=self.headers
                )
                self.assertEqual(meta_response.status_code, 200, meta_response.text)
                envelope = meta_response.json()
                self.assertEqual(envelope["code"], 200)
                metadata = envelope["data"]
                volume_response = await self.client.get(
                    "/api/v1/ionosphere/volume", params=params, headers=self.headers
                )
                self.assertEqual(volume_response.status_code, 200)
                self.assertEqual(volume_response.headers["content-type"], "application/octet-stream")
                self.assertEqual(len(volume_response.content), count * 4)
                self.assertEqual(metadata["byteLength"], len(volume_response.content))
                self.assertEqual(metadata["id"], hashlib.sha256(volume_response.content).hexdigest())
                self.assertEqual(volume_response.headers["x-volume-id"], metadata["id"])
                self.assertEqual(volume_response.headers["etag"], f'"{metadata["id"]}"')
                audit = await AuditLog.filter(path="/api/v1/ionosphere/volume").order_by("-id").first()
                self.assertEqual(audit.response_body["contentType"], "application/octet-stream")
                self.assertEqual(audit.response_body["byteLength"], count * 4)

    async def test_default_resolution_is_standard(self):
        response = await self.client.get("/api/v1/ionosphere/volume/metadata", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["longitude"]["count"], 72)

    async def test_unknown_resolution_is_rejected(self):
        for path in ("/volume", "/volume/metadata"):
            response = await self.client.get(
                "/api/v1/ionosphere" + path, params={"resolution": "huge"}, headers=self.headers
            )
            self.assertEqual(response.status_code, 422, response.text)

    async def test_both_endpoints_require_existing_token_auth(self):
        for path in ("/volume", "/volume/metadata"):
            for headers, status in (({}, 422), ({"token": "invalid"}, 401)):
                response = await self.client.get("/api/v1/ionosphere" + path, headers=headers)
                self.assertEqual(response.status_code, status, response.text)

    async def test_source_catalog_and_missing_dataset_have_explicit_status(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(sami3, "DATA_ROOT", Path(temporary)):
            response = await self.client.get("/api/v1/ionosphere/sources", headers=self.headers)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["data"]["defaultSource"], "mock")
            for endpoint in ("metadata", "binary"):
                path = "/api/v1/ionosphere/volume" + ("/metadata" if endpoint == "metadata" else "")
                response = await self.client.get(path, params={"source": "sami3"}, headers=self.headers)
                self.assertEqual(response.status_code, 503, response.text)
            response = await self.client.get("/api/v1/ionosphere/sources")
            self.assertEqual(response.status_code, 422)

    async def test_imported_source_metadata_binary_and_pinned_version(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = root / "source.nc"
            write_fixture(path)
            sami3.publish_snapshot(sami3.read_snapshot(path), root / "data")
            with patch.object(sami3, "DATA_ROOT", root / "data"):
                catalog = await self.client.get("/api/v1/ionosphere/sources", headers=self.headers)
                self.assertEqual(catalog.json()["data"]["defaultSource"], "sami3")
                response = await self.client.get(
                    "/api/v1/ionosphere/volume/metadata", params={"source": "sami3"}, headers=self.headers
                )
                self.assertEqual(response.status_code, 200, response.text)
                metadata = response.json()["data"]
                self.assertEqual(metadata["source"], "sami3-model")
                self.assertEqual(metadata["timestamp"], "2019-04-25T00:00:00Z")
                self.assertEqual(metadata["altitude"]["min"], 90)
                sami3.publish_snapshot(sami3.read_snapshot(path, 1), root / "data")
                binary = await self.client.get(
                    "/api/v1/ionosphere/volume",
                    params={"source": "sami3", "volumeId": metadata["id"]},
                    headers=self.headers,
                )
                self.assertEqual(binary.status_code, 200, binary.text[:50])
                self.assertEqual(hashlib.sha256(binary.content).hexdigest(), metadata["id"])
                invalid = await self.client.get(
                    "/api/v1/ionosphere/volume", params={"source": "../../bad"}, headers=self.headers
                )
                self.assertEqual(invalid.status_code, 422)


if __name__ == "__main__":
    unittest.main()
