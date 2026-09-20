from __future__ import annotations

import subprocess
from pathlib import Path

MAX_PUBLIC_BYTES = 10 * 1024 * 1024
GENERATED_PARTS = {
    ".playwright-cli",
    ".superpowers",
    ".venv",
    "node_modules",
    "dist",
    "output",
    "__pycache__",
}


def forbidden_reason(relative_path: str, size: int) -> str | None:
    path = Path(relative_path)
    lower_name = path.name.lower()
    if size > MAX_PUBLIC_BYTES:
        return "file exceeds 10 MiB"
    if any(part in GENERATED_PARTS for part in path.parts):
        return "generated dependency/build path"
    if lower_name.endswith((".sqlite3", ".sqlite3-shm", ".sqlite3-wal")) or ".sqlite3.backup-" in lower_name:
        return "database/runtime file"
    if lower_name.endswith((".nc", ".nc4")):
        return "scientific dataset"
    if lower_name in {".env", ".env.local"}:
        return "private environment file"
    return None


def tracked_files(root: Path) -> list[str]:
    output = subprocess.check_output(["git", "ls-files", "-z"], cwd=root)
    return [item.decode() for item in output.split(b"\0") if item]


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    failures = []
    for relative_path in tracked_files(root):
        path = root / relative_path
        if not path.is_file():
            continue
        reason = forbidden_reason(relative_path, path.stat().st_size)
        if reason:
            failures.append(f"{relative_path}: {reason}")
    if failures:
        print("Public repository audit failed:")
        print("\n".join(f"- {failure}" for failure in failures))
        return 1
    print("Public repository audit passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
