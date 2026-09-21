"""Sampling, physical shape, packing, and reproducibility of the mock volume."""

import hashlib
import importlib
import math
import struct
import unittest


class IonosphereVolumeTests(unittest.TestCase):
    def setUp(self):
        try:
            self.service = importlib.import_module("app.services.ionosphere")
        except ModuleNotFoundError:
            self.fail("The ionosphere volume service has not been implemented")

    def test_grid_and_float32_range_for_both_resolutions(self):
        for resolution, dimensions in (("standard", (72, 36, 32)), ("fine", (144, 72, 64))):
            with self.subTest(resolution=resolution):
                volume = self.service.get_volume(resolution)
                metadata = volume.metadata
                for axis, count, low, high in zip(
                    (metadata.longitude, metadata.latitude, metadata.altitude),
                    dimensions,
                    (-180, -90, 80),
                    (180, 90, 1000),
                ):
                    self.assertEqual((axis.min, axis.max, axis.count), (low, high, count))
                    self.assertAlmostEqual(axis.step, (high - low) / count)
                self.assertEqual(len(volume.data), math.prod(dimensions) * 4)
                self.assertEqual(metadata.byteLength, len(volume.data))
                values = [value[0] for value in struct.iter_unpack("<f", volume.data)]
                self.assertTrue(all(math.isfinite(value) and value > 0 for value in values))
                self.assertEqual(metadata.minValue, min(values))
                self.assertEqual(metadata.maxValue, max(values))
                self.assertGreaterEqual(metadata.minValue, 1e8)
                self.assertLessEqual(metadata.maxValue, 1.1e12)
                self.assertEqual(metadata.sampling, "cell-center")
                self.assertEqual(metadata.altitudeUnit, "km")
                self.assertEqual(metadata.parameter, "Ne")
                self.assertEqual(metadata.unit, "m^-3")
                self.assertEqual(metadata.dtype, "float32")
                self.assertEqual(metadata.byteOrder, "little")
                self.assertEqual(metadata.order, "zyx")
                self.assertEqual(metadata.source, "deterministic-mock")

    def test_payload_is_repeatable_after_cache_clear(self):
        self.service.get_volume.cache_clear()
        first = self.service.get_volume("standard")
        self.service.get_volume.cache_clear()
        second = self.service.get_volume("standard")
        self.assertEqual(first.data, second.data)
        self.assertEqual(first.metadata, second.metadata)
        self.assertEqual(first.metadata.id, hashlib.sha256(first.data).hexdigest())
        self.assertEqual(self.service.get_volume.cache_info().maxsize, 2)

    def test_x_longitude_is_fastest_at_cell_centers(self):
        volume = self.service.get_volume("standard")
        meta = volume.metadata
        nx, ny = meta.longitude.count, meta.latitude.count
        for x, y, z in ((0, 0, 0), (1, 0, 0), (0, 1, 0), (0, 0, 1), (71, 35, 31), (35, 17, 8)):
            coordinates = [
                axis.min + (index + 0.5) * axis.step
                for axis, index in ((meta.longitude, x), (meta.latitude, y), (meta.altitude, z))
            ]
            expected = struct.unpack("<f", struct.pack("<f", self.service.electron_density(*coordinates)))[0]
            actual = struct.unpack_from("<f", volume.data, (z * ny * nx + y * nx + x) * 4)[0]
            self.assertEqual(actual, expected)

    def test_longitude_is_periodic_and_continuous_at_the_seam(self):
        density = self.service.electron_density
        for latitude in (-90, -45, 0, 45, 90):
            for altitude in (110, 190, 300, 600):
                self.assertAlmostEqual(density(-180, latitude, altitude) / density(180, latitude, altitude), 1)
                self.assertAlmostEqual(density(27, latitude, altitude) / density(387, latitude, altitude), 1)
                self.assertLess(
                    abs(density(-179.999, latitude, altitude) / density(179.999, latitude, altitude) - 1), 1e-4
                )

    def test_profile_has_e_layer_f1_shoulder_and_dominant_latitude_dependent_f2(self):
        density = self.service.electron_density
        peaks = []
        for latitude in (-60, 0, 60):
            profile = {height: density(0, latitude, height) for height in range(80, 1001)}
            e_peak = max(range(95, 131), key=profile.get)
            self.assertTrue(105 <= e_peak <= 115)
            self.assertGreater(profile[e_peak], profile[90])
            self.assertGreater(profile[e_peak], profile[135])
            self.assertGreater(profile[190], profile[150])
            peak = max(profile, key=profile.get)
            peaks.append(peak)
            self.assertTrue(250 <= peak <= 350)
            self.assertGreater(profile[peak], 2 * profile[190])
            self.assertLess(profile[1000], 1e9)
        self.assertGreater(max(peaks) - min(peaks), 20)

    def test_invalid_resolution_never_allocates_a_volume(self):
        with self.assertRaises(ValueError):
            self.service.get_volume("huge")


if __name__ == "__main__":
    unittest.main()
