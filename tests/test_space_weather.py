"""GFZ responses are mocked; tests never contact the public archive."""

import asyncio
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch

import httpx
from fastapi import FastAPI

from app.core.dependency import DependAuth
from app.services import space_weather as weather
from app.api.v1.ionosphere.weather import router


class SpaceWeatherTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        weather._cache.clear()
        weather._pending.clear()

    def response(self, times=None, values=None):
        return httpx.Response(
            200,
            request=httpx.Request("GET", weather.SOURCE_URL),
            json={
                "datetime": times if times is not None else ["2019-04-25T12:00:00Z", "2019-04-25T15:00:00Z"],
                "Kp": values if values is not None else [1.667, 0.333],
                "meta": {"source": "GFZ Potsdam", "license": "CC BY 4.0"},
                "status": ["def", "def"],
            },
        )

    async def test_exact_interval_and_timezone_normalization(self):
        with patch.object(httpx.AsyncClient, "get", return_value=self.response()) as fetch:
            result = await weather.get_space_weather(datetime.fromisoformat("2019-04-25T22:59:59+08:00"))
        self.assertTrue(result["available"])
        self.assertEqual(result["kp"], 1.667)
        self.assertEqual(result["intervalStart"], "2019-04-25T12:00:00Z")
        self.assertEqual(result["intervalEnd"], "2019-04-25T15:00:00Z")
        self.assertIn("历史观测", result["label"])
        self.assertEqual(fetch.call_args.kwargs["params"]["start"], result["intervalStart"])
        self.assertIn("kp.gfz.de", result["sourceUrl"])

    async def test_end_boundary_and_midnight(self):
        for stamp, start, end in [
            ("2019-04-25T15:00:00Z", "2019-04-25T15:00:00Z", "2019-04-25T18:00:00Z"),
            ("2019-04-25T23:59:59Z", "2019-04-25T21:00:00Z", "2019-04-26T00:00:00Z"),
        ]:
            with patch.object(httpx.AsyncClient, "get", return_value=self.response([start], [2])):
                result = await weather.get_space_weather(datetime.fromisoformat(stamp))
            self.assertEqual((result["intervalStart"], result["intervalEnd"]), (start, end))

    async def test_bad_records_are_unavailable(self):
        for payload in [
            {"datetime": [], "Kp": []},
            {"datetime": ["2019-04-25T15:00:00Z"], "Kp": [7]},
            {"datetime": ["2019-04-25T12:00:00Z"], "Kp": [None]},
            {"datetime": ["2019-04-25T12:00:00Z"], "Kp": ["NaN"]},
            {"datetime": ["2019-04-25T12:00:00Z"], "Kp": [-1]},
            {"datetime": ["2019-04-25T12:00:00Z"], "Kp": [10]},
            {"datetime": ["2019-04-25T12:00:00Z"], "Kp": [True]},
            {"datetime": ["2019-04-25T12:00:00Z", "2019-04-25T12:00:00Z"], "Kp": [1, 2]},
            {"datetime": ["2019-04-25T12:00:00Z"], "Kp": []},
            [],
        ]:
            weather._cache.clear()
            response = httpx.Response(200, request=httpx.Request("GET", weather.SOURCE_URL), json=payload)
            with patch.object(httpx.AsyncClient, "get", return_value=response):
                result = await weather.get_space_weather(datetime.fromisoformat("2019-04-25T12:00:00Z"))
            self.assertFalse(result["available"], payload)
            self.assertIsNone(result["kp"])
            self.assertTrue(result["reason"])

    async def test_timeout_and_http_failure(self):
        for error in [httpx.ReadTimeout("slow"), httpx.ConnectError("offline")]:
            weather._cache.clear()
            with patch.object(httpx.AsyncClient, "get", side_effect=error):
                result = await weather.get_space_weather(datetime.fromisoformat("2019-04-25T12:00:00Z"))
            self.assertFalse(result["available"])
            self.assertTrue(result["reason"])

    async def test_bad_json_numeric_nan_and_remote_http_error(self):
        for status, body in [
            (200, b"not json"),
            (503, b"unavailable"),
            (200, b'{"datetime":["2019-04-25T12:00:00Z"],"Kp":[NaN]}'),
        ]:
            weather._cache.clear()
            response = httpx.Response(status, request=httpx.Request("GET", weather.SOURCE_URL), content=body)
            with patch.object(httpx.AsyncClient, "get", return_value=response):
                result = await weather.get_space_weather(datetime.fromisoformat("2019-04-25T12:00:00Z"))
            self.assertFalse(result["available"])
            self.assertIsNone(result["kp"])

    async def test_classification_boundaries(self):
        for kp, level in [
            (0, "quiet"),
            (3.667, "quiet"),
            (4, "active"),
            (4.667, "active"),
            (5, "G1"),
            (6, "G2"),
            (7, "G3"),
            (8, "G4"),
            (8.667, "G4"),
            (9, "G5"),
        ]:
            weather._cache.clear()
            with patch.object(httpx.AsyncClient, "get", return_value=self.response(values=[kp, 1])):
                result = await weather.get_space_weather(datetime.fromisoformat("2019-04-25T12:00:00Z"))
            self.assertEqual(result["level"], level)

    async def test_cache_single_flight_and_bounded_eviction(self):
        stamp = datetime.fromisoformat("2019-04-25T12:00:00Z")
        with patch.object(httpx.AsyncClient, "get", return_value=self.response()) as fetch:
            results = await asyncio.gather(*(weather.get_space_weather(stamp) for _ in range(12)))
            self.assertTrue(all(row["kp"] == 1.667 for row in results))
            results[0]["kp"] = 9
            self.assertEqual((await weather.get_space_weather(stamp))["kp"], 1.667)
            self.assertEqual(fetch.call_count, 1)
            with patch.object(weather, "MAX_CACHE_ENTRIES", 2):
                for days in (1, 2, 3):
                    await weather.get_space_weather(stamp + timedelta(days=days))
                self.assertEqual(len(weather._cache), 2)

    async def test_total_deadline_and_concurrency_bound(self):
        stamp = datetime.fromisoformat("2019-04-25T12:00:00Z")

        async def slow(*args, **kwargs):
            await asyncio.sleep(1)

        with patch.object(httpx.AsyncClient, "get", side_effect=slow), patch.object(weather, "TOTAL_TIMEOUT", 0.03):
            results = await asyncio.gather(*(weather.get_space_weather(stamp + timedelta(days=i)) for i in range(10)))
        self.assertTrue(all(not row["available"] for row in results))
        self.assertTrue(any("繁忙" in row["reason"] for row in results))
        self.assertEqual(len(weather._pending), 0)

    async def test_route_auth_and_invalid_dates_before_fetch(self):
        app = FastAPI()
        app.include_router(router)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            self.assertEqual(
                (await client.get("/space-weather", params={"timestamp": "2019-04-25T12:00:00Z"})).status_code, 422
            )
            app.dependency_overrides[DependAuth.dependency] = lambda: object()
            for stamp in ["2019-04-25T12:00:00", "bad", "1931-12-31T23:00:00Z", "2999-01-01T00:00:00Z", "1556193600"]:
                with patch.object(weather, "_fetch", side_effect=AssertionError("Invalid date reached GFZ")):
                    response = await client.get("/space-weather", params={"timestamp": stamp})
                self.assertEqual(response.status_code, 422, response.text)

    async def test_route_success_and_expired_cache_refetch(self):
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[DependAuth.dependency] = lambda: object()
        original = httpx.AsyncClient.get
        calls = []

        async def get(client, url, **kwargs):
            if str(url).startswith("/space-weather"):
                return await original(client, url, **kwargs)
            calls.append(url)
            return self.response()

        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            with patch.object(httpx.AsyncClient, "get", get):
                response = await client.get("/space-weather", params={"timestamp": "2019-04-25T12:00:00Z"})
                self.assertEqual(response.status_code, 200)
                result = response.json()["data"]
                self.assertEqual(result["kp"], 1.667)
                self.assertEqual(
                    set(result),
                    {
                        "available",
                        "kp",
                        "intervalStart",
                        "intervalEnd",
                        "level",
                        "label",
                        "source",
                        "sourceUrl",
                        "reason",
                    },
                )
                key = result["intervalStart"]
                weather._cache[key] = (0, weather._cache[key][1])
                await client.get("/space-weather", params={"timestamp": "2019-04-25T12:00:00Z"})
                self.assertEqual(len(calls), 2)


if __name__ == "__main__":
    unittest.main()
