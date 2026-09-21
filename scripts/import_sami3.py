"""Import the supplied SAMI3 NetCDF without modifying or copying the original."""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.sami3 import DATA_ROOT, load_imported_volume, publish_snapshot, read_snapshot  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", type=Path)
    parser.add_argument("--time-index", type=int, default=0)
    args = parser.parse_args()
    snapshot = read_snapshot(args.file, args.time_index)
    publish_snapshot(snapshot)
    print(f"Imported {snapshot.timestamp}, source SHA256 {snapshot.source_sha256}")
    print(f"Output: {DATA_ROOT}")
    for resolution in ("standard", "fine"):
        print(resolution, load_imported_volume(resolution).metadata.model_dump_json(exclude_none=True))


if __name__ == "__main__":
    main()
