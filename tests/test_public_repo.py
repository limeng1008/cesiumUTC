from scripts.check_public_repo import forbidden_reason


def test_rejects_runtime_and_scientific_data():
    assert forbidden_reason("db.sqlite3", 100) == "database/runtime file"
    assert forbidden_reason("db.sqlite3.backup-20260920", 100) == "database/runtime file"
    assert forbidden_reason("data/ionosphere/run/source.nc", 100) == "scientific dataset"
    assert forbidden_reason("web/node_modules/vue/index.js", 100) == "generated dependency/build path"


def test_rejects_oversized_files():
    assert forbidden_reason("docs/assets/demo.mp4", 10 * 1024 * 1024 + 1) == "file exceeds 10 MiB"


def test_allows_source_and_small_curated_media():
    assert forbidden_reason("app/api/v1/cesium/__init__.py", 100) is None
    assert forbidden_reason("docs/assets/hero-ionosphere.png", 2 * 1024 * 1024) is None
