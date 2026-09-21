import tempfile
import unittest
from pathlib import Path

import netCDF4
import numpy as np
from pydantic import ValidationError

from app.services import sami3
from app.services.dataset_worker import inspect_file
from test_sami3 import write_fixture


def add_parameters(path):
    with netCDF4.Dataset(path, "a") as source:
        for name, unit, value in (("te", "K", 1200), ("ti0", "kelvin", 850), ("n_oplus", "cm-3", 200)):
            variable = source.createVariable(name, "f8", ("nt", "nlat", "nlon", "nalt"))
            variable.units = unit
            variable[:] = value


class ParameterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "fields.nc"
        write_fixture(self.path)
        add_parameters(self.path)

    def test_preview_and_actual_temperature_species_import(self):
        preview = inspect_file(str(self.path))
        fields = {p["parameter"]: p for p in preview.get("parameters", [])}
        self.assertEqual(set(fields), {"Ne", "Te", "Ti", "Ni_O+"})
        self.assertEqual(preview["variable"], "dene0")
        self.assertTrue(all(p["available"] for p in fields.values()))
        for parameter, expected, unit in (("Te", 1200, "K"), ("Ti", 850, "K"), ("Ni_O+", 200e6, "m^-3")):
            snapshot = sami3.read_snapshot(self.path, 0, parameter)
            np.testing.assert_array_equal(snapshot.density, expected)
            volume = sami3.resample_snapshot(snapshot, "standard")
            self.assertEqual(volume.metadata.parameter, parameter)
            self.assertEqual(volume.metadata.unit, unit)
            self.assertEqual(volume.metadata.sourceVariable, fields[parameter]["sourceVariable"])
            self.assertEqual(volume.metadata.defaultNormalization, "linear" if unit == "K" else "log")
            self.assertEqual(fields[parameter]["dimensions"], ["nt", "nlat", "nlon", "nalt"])
            self.assertEqual(fields[parameter]["shape"], [2, 3, 4, 3])
            target = Path(self.temp.name) / parameter
            sami3.publish_snapshot(snapshot, target)
            self.assertEqual(
                sami3.load_imported_volume("standard", target, parameter=parameter).metadata.parameter, parameter
            )
            with self.assertRaises(FileNotFoundError):
                sami3.load_imported_volume("standard", target, parameter="Ne")
            with self.assertRaises(ValidationError):
                type(volume.metadata).model_validate(
                    {**volume.metadata.model_dump(), "unit": "K" if unit == "m^-3" else "m^-3"}
                )

    def test_unavailable_units_alias_conflict_extra_dimension_and_unknown_species_retained(self):
        with netCDF4.Dataset(self.path, "a") as source:
            source["te"].units = "eV"
            alias = source.createVariable("Ti", "f8", ("nt", "nlat", "nlon", "nalt"))
            alias.units = "K"
            source.createDimension("species", 7)
            variable = source.createVariable("n_hplus", "f8", ("nt", "species", "nlat", "nlon", "nalt"))
            variable.units = "cm-3"
            source.createVariable("deni0", "f8", ("nt", "species", "nlat", "nlon", "nalt"))
        fields = inspect_file(str(self.path)).get("parameters", [])
        for parameter in ("Te", "Ti", "Ni_H+", "deni0"):
            entries = [p for p in fields if p["parameter"] == parameter]
            self.assertTrue(entries, parameter)
            self.assertTrue(all(not p["available"] and p["reason"] for p in entries))
        for parameter in ("Te", "Ti", "Ni_H+"):
            with self.assertRaises(ValueError):
                sami3.read_snapshot(self.path, 0, parameter)

    def test_zero_density_preserved_and_nonpositive_temperature_masked(self):
        with netCDF4.Dataset(self.path, "a") as source:
            source["dene0"][:] = 0
            source["te"][0, 1, 0, 1] = 0
        snapshot = sami3.read_snapshot(self.path)
        self.assertEqual(snapshot.density[1, 0, 1], 0)
        volume = sami3.resample_snapshot(snapshot, "standard")
        self.assertEqual(volume.metadata.minValue, 0)
        self.assertEqual(volume.metadata.maxValue, 0)
        self.assertTrue(np.isnan(sami3.read_snapshot(self.path, parameter="Te").density[1, 0, 1]))

    def test_non_numeric_candidate_is_explicitly_unavailable(self):
        with netCDF4.Dataset(self.path, "a") as source:
            source.renameVariable("te", "unused_temperature")
            variable = source.createVariable("Te", "S1", ("nt", "nlat", "nlon", "nalt"))
            variable.units = "K"
        fields = inspect_file(str(self.path))["parameters"]
        entry = next(p for p in fields if p["parameter"] == "Te")
        self.assertFalse(entry["available"])
        self.assertTrue(entry["reason"])

    def test_first_missing_time_does_not_disable_later_valid_parameter(self):
        with netCDF4.Dataset(self.path, "a") as source:
            source["te"][0] = 0
        fields = inspect_file(str(self.path))["parameters"]
        entry = next(p for p in fields if p["parameter"] == "Te")
        self.assertTrue(entry["available"], entry)
        self.assertFalse(entry["firstTimeValid"])
        with self.assertRaises(ValueError):
            sami3.read_snapshot(self.path, 0, "Te")
        self.assertEqual(sami3.read_snapshot(self.path, 1, "Te").density[0, 0, 0], 1200)

    def test_integer_temperature_fill_values_preserve_other_parameters_and_missing_cells(self):
        with netCDF4.Dataset(self.path, "a") as source:
            source.renameVariable("te", "unused_temperature")
            variable = source.createVariable("te", "i2", ("nt", "nlat", "nlon", "nalt"), fill_value=-999)
            variable.units = "K"
            variable[:] = 1200
            variable[0, 0, 0, 0] = -999
        try:
            fields = inspect_file(str(self.path))["parameters"]
        except Exception as error:
            self.fail(f"Integer temperature must not fail the whole preview: {error}")
        for parameter in ("Ne", "Te"):
            self.assertTrue(next(p for p in fields if p["parameter"] == parameter)["available"])
        snapshot = sami3.read_snapshot(self.path, parameter="Te")
        self.assertTrue(np.isnan(snapshot.density[0, 0, 0]))
        self.assertEqual(snapshot.density[0, 0, 1], 1200)

    def test_explicit_generic_ion_declarations_cannot_be_mapped_to_electron_fields(self):
        for variable, parameter, attribute, value in (
            ("te", "Te", "long_name", "Ion temperature"),
            ("te", "Te", "standard_name", "ion_temperature"),
            ("dene0", "Ne", "standard_name", "ion_number_density"),
        ):
            with self.subTest(variable=variable, attribute=attribute):
                with netCDF4.Dataset(self.path, "a") as source:
                    source[variable].setncattr(attribute, value)
                entry = next(p for p in inspect_file(str(self.path))["parameters"] if p["parameter"] == parameter)
                self.assertFalse(entry["available"], entry)
                self.assertTrue(entry["reason"])
                with self.assertRaises(ValueError):
                    sami3.read_snapshot(self.path, parameter=parameter)
                with netCDF4.Dataset(self.path, "a") as source:
                    source[variable].delncattr(attribute)

    def test_explicit_species_conflicts_and_species_temperature_are_rejected(self):
        declarations = (
            ("n_oplus", "species", "H+", "Ni_O+"),
            ("n_oplus", "long_name", "Hydrogen ion density", "Ni_O+"),
            ("n_oplus", "long_name", "O2+ density", "Ni_O+"),
            ("ti0", "species", "O+", "Ti"),
            ("ti0", "long_name", "O+ ion temperature", "Ti"),
        )
        for variable, attribute, value, parameter in declarations:
            with self.subTest(variable=variable, attribute=attribute, value=value):
                with netCDF4.Dataset(self.path, "a") as source:
                    source[variable].setncattr(attribute, value)
                entries = inspect_file(str(self.path))["parameters"]
                entry = next(p for p in entries if p["parameter"] == parameter)
                self.assertFalse(entry["available"], entry)
                self.assertTrue(entry["reason"])
                with self.assertRaises(ValueError):
                    sami3.read_snapshot(self.path, parameter=parameter)
                with netCDF4.Dataset(self.path, "a") as source:
                    source[variable].delncattr(attribute)

    def test_metadata_rejects_missing_species_and_contradictory_sources_but_keeps_legacy_ne(self):
        metadata = sami3.resample_snapshot(sami3.read_snapshot(self.path, parameter="Ni_O+"), "standard").metadata
        for update in ({"species": None}, {"sourceVariable": "te"}, {"sourceUnit": "K"}):
            with self.subTest(update=update), self.assertRaises(ValidationError):
                type(metadata).model_validate({**metadata.model_dump(), **update})
        legacy = sami3.resample_snapshot(sami3.read_snapshot(self.path), "standard").metadata.model_dump()
        for key in ("parameter", "species", "sourceVariable", "sourceUnit", "defaultNormalization"):
            legacy.pop(key)
        self.assertEqual(type(metadata).model_validate(legacy).parameter, "Ne")
