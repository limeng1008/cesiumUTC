"""Small real NetCDF fixtures exercise units, axes, missing cells and artifacts."""

import tempfile
import unittest
from pathlib import Path

import netCDF4
import numpy as np

from app.services import sami3


def write_fixture(path, units="cm-3", missing=False):
    with netCDF4.Dataset(path, "w") as d:
        for name, size in (("nt", 2), ("nlat", 3), ("nlon", 4), ("nalt", 3)):
            d.createDimension(name, size)
        for name, dim, values, unit in (
            ("time", "nt", [1556150400, 1556151000], "Seconds since 0:00 UT 1/1/1970"),
            ("lat", "nlat", [-89, 0, 88.5], "Degrees"),
            ("lon", "nlon", [0, 90, 180, 270], "Degrees"),
            ("alt", "nalt", [90, 300, 1100], "Kilometres"),
        ):
            v = d.createVariable(name, "f8", (dim,))
            v.units = unit
            v[:] = values
        v = d.createVariable("dene0", "f8", ("nt", "nlat", "nlon", "nalt"), fill_value=-999)
        v.units = units
        lat = np.array([-89, 0, 88.5])[:, None, None]
        alt = np.array([90, 300, 1100])[None, None, :]
        lon_effect = np.array([0, 90, 180, 270])[None, :, None]
        v[0] = 1000 + 2 * lat + 3 * alt + lon_effect
        v[1] = v[0] * 2
        if missing:
            v[0, 1, 0, 1] = -999


class Sami3Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "sample.nc"
        write_fixture(self.path)

    def test_read_converts_cm3_to_m3_and_keeps_snapshot_time(self):
        s = sami3.read_snapshot(self.path)
        self.assertEqual(s.timestamp, "2019-04-25T00:00:00Z")
        self.assertEqual(s.density.shape, (3, 4, 3))
        self.assertEqual(s.density[1, 0, 1], 1900e6)
        self.assertEqual(len(s.source_sha256), 64)
        self.assertEqual(sami3.read_snapshot(self.path, 1).density[1, 0, 1], 3800e6)

    def test_nonuniform_altitude_affine_interpolation_and_periodic_seam(self):
        s = sami3.read_snapshot(self.path)
        # Positive longitude is affine in this cell; -45 wraps halfway 270->0.
        values = sami3.interpolate(s, np.array([45, -45]), np.array([10]), np.array([200]))
        np.testing.assert_allclose(values[0, 0], np.array([1665, 1755]) * 1e6)

    def test_outside_native_domain_and_missing_neighbors_are_nodata(self):
        s = sami3.read_snapshot(self.path)
        self.assertEqual(sami3.interpolate(s, np.array([0]), np.array([89]), np.array([200]))[0, 0, 0], -999)
        self.assertEqual(sami3.interpolate(s, np.array([0]), np.array([0]), np.array([80]))[0, 0, 0], -999)
        self.path.unlink()
        write_fixture(self.path, missing=True)
        s = sami3.read_snapshot(self.path)
        self.assertEqual(sami3.interpolate(s, np.array([45]), np.array([10]), np.array([200]))[0, 0, 0], -999)
        # Exact valid node must not be polluted by zero-weight missing neighbors.
        self.assertEqual(sami3.interpolate(s, np.array([90]), np.array([0]), np.array([90]))[0, 0, 0], 1360e6)

    def test_rejects_units_index_and_nonmonotonic_axis(self):
        self.path.unlink()
        write_fixture(self.path, units="TECU")
        with self.assertRaisesRegex(ValueError, "单位"):
            sami3.read_snapshot(self.path)
        self.path.unlink()
        write_fixture(self.path)
        with self.assertRaises(ValueError):
            sami3.read_snapshot(self.path, -1)
        with self.assertRaises(ValueError):
            sami3.read_snapshot(self.path, 2)
        with netCDF4.Dataset(self.path, "a") as d:
            d["alt"][:] = [90, 300, 200]
        with self.assertRaisesRegex(ValueError, "递增"):
            sami3.read_snapshot(self.path)

    def test_volume_is_cell_centered_zyx_and_publish_is_reloadable(self):
        s = sami3.read_snapshot(self.path)
        v = sami3.resample_snapshot(s, "standard")
        m = v.metadata
        self.assertEqual((m.altitude.min, m.altitude.max), (90, 1000))
        self.assertEqual(m.altitude.step, 910 / 32)
        self.assertEqual(m.source, "sami3-model")
        self.assertEqual(m.noDataValue, -999)
        a = np.frombuffer(v.data, dtype="<f4").reshape(32, 36, 72)
        z, y, x = 3, 20, 40
        expected = sami3.interpolate(
            s, np.array([-180 + (x + 0.5) * 5]), np.array([-90 + (y + 0.5) * 5]), np.array([90 + (z + 0.5) * 910 / 32])
        )
        self.assertEqual(a[z, y, x], np.float32(expected[0, 0, 0]))
        target = Path(self.temp.name) / "converted"
        sami3.publish_snapshot(s, target)
        loaded = sami3.load_imported_volume("standard", target)
        self.assertEqual(loaded.data, v.data)
        self.assertEqual(loaded.metadata.id, m.id)
        fine = sami3.load_imported_volume("fine", target)
        self.assertEqual(len(fine.data), 144 * 72 * 64 * 4)
        self.assertGreater(np.count_nonzero(np.frombuffer(fine.data, dtype="<f4") == -999), 0)
        # Pinning metadata's id still resolves after re-importing another time.
        sami3.publish_snapshot(sami3.read_snapshot(self.path, 1), target)
        self.assertEqual(sami3.load_imported_volume("standard", target, m.id).data, v.data)
        with self.assertRaises(ValueError):
            sami3.load_imported_volume("standard", target, "../bad")


if __name__ == "__main__":
    unittest.main()
