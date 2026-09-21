"""One bounded SQLite migration with a consistent backup and atomic table rebuild.

Run before Aerich/ORM initialization. Existing task IDs and all unknown columns,
indexes and triggers are retained; artifact directories are never touched.
"""

import json
import re
import sqlite3
import uuid
from contextlib import closing
from pathlib import Path

from tortoise import fields


def _quote(name):
    return '"' + name.replace('"', '""') + '"'


def _update_history(connection):
    if not connection.execute("SELECT 1 FROM sqlite_master WHERE name='aerich'").fetchone():
        return
    row = connection.execute("SELECT id, content FROM aerich WHERE app='models' ORDER BY id DESC LIMIT 1").fetchone()
    if not row:
        return
    history = json.loads(row[1])
    model = history.get("models.IonosphereImport")
    if model is None:
        return
    # Aerich automatically compares its latest snapshot at startup. Reconcile
    # only the alteration committed in this same transaction.
    field = fields.CharField(max_length=16, default="Ne").describe(serializable=True)
    field.update(name="parameter", db_column="parameter")
    model["data_fields"] = [f for f in model["data_fields"] if f["name"] != "parameter"] + [field]
    model["unique_together"] = [["dataset", "time_index", "parameter"]]
    connection.execute("UPDATE aerich SET content=? WHERE id=?", (json.dumps(history), row[0]))


def migrate_sqlite_parameters(path: Path) -> Path | None:
    path = Path(path)
    if not path.is_file():
        return None
    with closing(sqlite3.connect(path, timeout=30)) as connection:
        if not connection.execute("SELECT 1 FROM sqlite_master WHERE name='ionosphere_import'").fetchone():
            return None
        connection.execute("PRAGMA foreign_keys=OFF")
        connection.execute("BEGIN IMMEDIATE")
        try:
            columns = [r[1] for r in connection.execute("PRAGMA table_info(ionosphere_import)")]
            unique_columns = [
                tuple(r[2] for r in connection.execute(f"PRAGMA index_info({_quote(index[1])})"))
                for index in connection.execute("PRAGMA index_list(ionosphere_import)").fetchall()
                if index[2]
            ]
            if "parameter" in columns and ("dataset_id", "time_index", "parameter") in unique_columns:
                if ("dataset_id", "time_index") in unique_columns:
                    raise ValueError("任务表同时存在旧唯一约束，请检查数据库迁移")
                connection.rollback()
                return None
            backup = path.with_name(path.name + ".backup-parameters-" + uuid.uuid4().hex)
            # A separate reader sees the stable pre-migration state while this
            # connection's reserved write lock excludes concurrent writers.
            with closing(sqlite3.connect(path)) as reader, closing(sqlite3.connect(backup)) as output:
                reader.backup(output)
                if output.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                    raise ValueError("数据库备份完整性检查失败")
            if "parameter" not in columns:
                connection.execute(
                    "ALTER TABLE ionosphere_import ADD COLUMN parameter VARCHAR(16) NOT NULL DEFAULT 'Ne'"
                )
            original = connection.execute("SELECT sql FROM sqlite_master WHERE name='ionosphere_import'").fetchone()[0]
            pair = r'UNIQUE\s*\(\s*["`\[]?dataset_id["`\]]?\s*,\s*["`\[]?time_index["`\]]?\s*\)'
            rewritten, count = re.subn(pair, 'UNIQUE ("dataset_id", "time_index", "parameter")', original, flags=re.I)
            ancillary = connection.execute(
                "SELECT type,sql FROM sqlite_master WHERE tbl_name='ionosphere_import' AND type IN ('index','trigger') AND sql IS NOT NULL"
            ).fetchall()
            # This deployment's old uniqueness is a table constraint. Abort on
            # an unexpected schema instead of silently weakening constraints.
            if count != 1:
                raise ValueError("任务表的旧唯一约束不符合受控迁移结构")
            temporary = "ionosphere_import_parameters_migration"
            rewritten = re.sub(
                r'(?i)(CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?)(?:"ionosphere_import"|ionosphere_import)',
                lambda match: match[1] + _quote(temporary),
                rewritten,
                count=1,
            )
            connection.execute(rewritten)
            columns = [r[1] for r in connection.execute("PRAGMA table_info(ionosphere_import)")]
            names = ",".join(_quote(c) for c in columns)
            connection.execute(f"INSERT INTO {_quote(temporary)} ({names}) SELECT {names} FROM ionosphere_import")
            if connection.execute(
                f"SELECT {names} FROM ionosphere_import EXCEPT SELECT {names} FROM {_quote(temporary)}"
            ).fetchone():
                raise ValueError("迁移前后任务记录不一致")
            connection.execute("DROP TABLE ionosphere_import")
            connection.execute(f"ALTER TABLE {_quote(temporary)} RENAME TO ionosphere_import")
            for _, sql in ancillary:
                connection.execute(sql)
            _update_history(connection)
            if connection.execute("PRAGMA foreign_key_check").fetchone():
                raise ValueError("迁移后外键完整性检查失败")
            if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("迁移后数据库完整性检查失败")
            connection.commit()
            return backup
        except BaseException:
            connection.rollback()
            raise


def migrate_configured_sqlite(config):
    for connection in config.get("connections", {}).values():
        if isinstance(connection, dict) and connection.get("engine") == "tortoise.backends.sqlite":
            path = connection.get("credentials", {}).get("file_path")
            if path and path != ":memory:":
                migrate_sqlite_parameters(Path(path))
        elif isinstance(connection, str) and connection.startswith("sqlite://"):
            path = connection[len("sqlite://") :]
            if path != ":memory:":
                migrate_sqlite_parameters(Path(path))
