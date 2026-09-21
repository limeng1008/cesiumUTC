from pathlib import Path

from app.settings.config import Settings
from scripts.check_public_repo import forbidden_reason


ROOT = Path(__file__).resolve().parents[1]


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


def test_development_secret_is_generated_and_environment_can_override(monkeypatch):
    monkeypatch.delenv("SECRET_KEY", raising=False)
    assert Settings().SECRET_KEY != Settings().SECRET_KEY

    monkeypatch.setenv("SECRET_KEY", "test-only-environment-secret")
    assert Settings().SECRET_KEY == "test-only-environment-secret"


def test_runtime_branding_points_to_cesiumutc():
    expected = {
        "app/settings/config.py": "CesiumUTC",
        "web/package.json": '"name": "cesiumutc-web"',
        "web/i18n/messages/en.json": '"app_name": "CesiumUTC"',
        "web/i18n/messages/cn.json": '"app_name": "CesiumUTC"',
        "web/src/layout/components/header/components/GithubSite.vue": "https://github.com/limeng1008/cesiumUTC",
        "Dockerfile": "/opt/cesiumutc",
        "deploy/web.conf": "/opt/cesiumutc/web/dist",
    }
    for relative_path, marker in expected.items():
        assert marker in (ROOT / relative_path).read_text(), relative_path
