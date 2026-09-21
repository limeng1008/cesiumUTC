# Local setup and validation

This guide runs CesiumUTC on a local development machine. It does not describe a hardened public deployment.

## Prerequisites

- Python 3.11 or newer
- [uv](https://docs.astral.sh/uv/)
- Node.js 20 or newer
- pnpm 10 through Corepack or a standalone installation
- A WebGL2-capable browser with hardware acceleration enabled
- Git

Check the toolchain:

```bash
python3 --version
uv --version
node --version
pnpm --version
```

## Backend

From the repository root:

```bash
uv sync --frozen
uv run python run.py
```

The backend listens on <http://127.0.0.1:9999>. OpenAPI documentation is available at <http://127.0.0.1:9999/docs>.

The local SQLite database is created at runtime and ignored by Git. Do not publish a database copied from another environment.

## Frontend

In a second terminal:

```bash
cd web
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Vite listens on <http://127.0.0.1:3100>. The main 3D workspace is <http://127.0.0.1:3100/ionosphere>.

`predev` copies the Cesium runtime, workers, widgets, and local Natural Earth II imagery from the installed dependency to `web/public/cesium/`. The generated directory is ignored by Git.

## Default development account

The upstream administration scaffold seeds this localhost-only development account:

```text
username: admin
password: 123456
```

These values are not production credentials. Replace the account, secret keys, origin policy, database, proxy, and transport configuration before making the service accessible from another machine or network.

When `SECRET_KEY` is unset, CesiumUTC generates an ephemeral signing key at process start so the localhost quick start does not publish a shared key. Set a persistent, randomly generated `SECRET_KEY` through the environment for any non-local deployment; never commit that value.

## Optional SAMI3 import

The deterministic mock field works without an external file. To inspect and import SAMI3 NetCDF data through the command line:

```bash
uv run python scripts/import_sami3.py --help
```

The web interface also supports upload, inspection, time/parameter selection, single import, batch import, cancellation, and progress tracking under **Data Management**.

Imported files and normalized volumes live below `data/ionosphere/`. They are private local runtime data and are ignored by Git. Review [docs/SAMI3_IMPORT.md](docs/SAMI3_IMPORT.md) and [docs/BATCH_IMPORT.md](docs/BATCH_IMPORT.md) before importing research data.

## Build

```bash
cd web
pnpm build
```

The production bundle is written to `web/dist/`. `prebuild` refreshes the local Cesium runtime before Vite builds the application.

To build the container image:

```bash
docker build --no-cache -t cesiumutc .
```

The image contains source and application dependencies, not local databases or NetCDF datasets.

## Test

Backend and repository hygiene:

```bash
uv run python -m pytest -q
uv run ruff check app scripts tests
uv run python scripts/check_public_repo.py
```

Frontend:

```bash
cd web
pnpm type-check
pnpm test
pnpm build
```

The Node test suite covers scientific interpolation, colour transfer, regional clipping, sections, data-management concurrency, managed imports, temporal analysis, derived metrics, and key Vue presentation contracts.

## Troubleshooting

### The 3D scene is blank

Confirm WebGL2 and hardware acceleration are enabled. Open browser developer tools and check for blocked local Cesium assets under `/cesium/`. Run `pnpm prepare:cesium` and restart Vite if the generated runtime is missing.

### The page redirects to login

Start the backend before the frontend, then sign in with the local development account. Authentication requests use the Vite proxy during development.

### No managed dataset appears

The production data workflow does not silently select an unrelated dataset. Upload and import a compatible file in **Data Management**, or use the deterministic mock paths documented in the project-specific development pages.

### A SAMI3 file is rejected

Read the inspection error first. Common causes are ambiguous axis names, unsupported units, invalid coordinate order, missing timestamps, a non-regular volume, or a parameter mismatch. See [docs/SAMI3_IMPORT.md](docs/SAMI3_IMPORT.md).

### Tests cannot import `app`

Run pytest as a Python module from the repository root:

```bash
uv run python -m pytest -q
```

Using an unrelated global `pytest` executable can produce a different module search path.

### Build output is very large

CesiumJS is a substantial runtime. Vite may report a large Cesium-containing chunk. This is currently a warning, not a build failure; generated `.gz` assets are created for deployment.
