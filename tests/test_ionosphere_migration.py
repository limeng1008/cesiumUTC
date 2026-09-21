import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch


class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "legacy.sqlite3"
        with closing(sqlite3.connect(self.path)) as conn, conn:
            conn.executescript(
                """
                CREATE TABLE ionosphere_dataset (id TEXT PRIMARY KEY);
                INSERT INTO ionosphere_dataset VALUES ('dataset-1');
                CREATE TABLE ionosphere_import (
                    id TEXT PRIMARY KEY, dataset_id TEXT REFERENCES ionosphere_dataset(id),
                    time_index INTEGER NOT NULL, status TEXT, artifact TEXT,
                    CONSTRAINT old_unique UNIQUE (dataset_id, time_index));
                CREATE INDEX custom_status ON ionosphere_import(status);
                INSERT INTO ionosphere_import VALUES ('keep-task-id','dataset-1',0,'ready','immutable/path');
                CREATE TABLE aerich (id INTEGER PRIMARY KEY, app TEXT, content TEXT);
            """
            )
            history = {
                "models.IonosphereImport": {"unique_together": [["dataset", "time_index"]], "data_fields": []},
                "other": 123,
            }
            conn.execute("INSERT INTO aerich VALUES (1,'models',?)", (json.dumps(history),))

    def test_transactional_migration_preserves_ids_artifacts_and_backup_is_idempotent(self):
        from app.services.ionosphere_migration import migrate_sqlite_parameters

        backup = migrate_sqlite_parameters(self.path)
        self.assertTrue(backup.is_file())
        with closing(sqlite3.connect(backup)) as conn:
            self.assertNotIn("parameter", [r[1] for r in conn.execute("PRAGMA table_info(ionosphere_import)")])
        with closing(sqlite3.connect(self.path)) as conn, conn:
            row = conn.execute(
                "SELECT id,dataset_id,time_index,status,artifact,parameter FROM ionosphere_import"
            ).fetchone()
            self.assertEqual(row, ("keep-task-id", "dataset-1", 0, "ready", "immutable/path", "Ne"))
            conn.execute("INSERT INTO ionosphere_import VALUES ('temperature','dataset-1',0,'queued','other','Te')")
            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute("INSERT INTO ionosphere_import VALUES ('duplicate','dataset-1',0,'queued','other','Te')")
            self.assertIn("custom_status", [r[1] for r in conn.execute("PRAGMA index_list(ionosphere_import)")])
            history = json.loads(conn.execute("SELECT content FROM aerich").fetchone()[0])
            self.assertEqual(history["other"], 123)
            self.assertEqual(
                history["models.IonosphereImport"]["unique_together"], [["dataset", "time_index", "parameter"]]
            )
        self.assertIsNone(migrate_sqlite_parameters(self.path))
        self.assertEqual(len(list(self.path.parent.glob("*.backup-*"))), 1)

    def test_error_after_rebuild_rolls_back_original_table_and_history(self):
        from app.services import ionosphere_migration

        with patch.object(ionosphere_migration, "_update_history", side_effect=ValueError("injected failure")):
            with self.assertRaisesRegex(ValueError, "injected failure"):
                ionosphere_migration.migrate_sqlite_parameters(self.path)
        with closing(sqlite3.connect(self.path)) as conn:
            self.assertNotIn("parameter", [r[1] for r in conn.execute("PRAGMA table_info(ionosphere_import)")])
            self.assertEqual(
                conn.execute("SELECT id,artifact FROM ionosphere_import").fetchall(),
                [("keep-task-id", "immutable/path")],
            )
            self.assertEqual(conn.execute("PRAGMA integrity_check").fetchone()[0], "ok")


class StartupMigrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_migration_failure_stops_before_orm_initialization(self):
        from app.core.init_app import init_db

        with (
            patch(
                "app.services.ionosphere_migration.migrate_configured_sqlite",
                side_effect=ValueError("migration failed"),
            ),
            patch("app.core.init_app.Command") as command,
        ):
            with self.assertRaisesRegex(ValueError, "migration failed"):
                await init_db()
            command.assert_not_called()
