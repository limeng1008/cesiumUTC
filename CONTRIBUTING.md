# Contributing to CesiumUTC

Thank you for helping improve CesiumUTC. Contributions to visualization, data adapters, scientific documentation, tests, accessibility, and performance are welcome.

## Before you start

Open an issue before beginning a large feature, architectural change, new data format, or change to a scientific calculation. This lets maintainers and contributors agree on scope, validation data, and acceptance criteria before substantial work begins. Small fixes and documentation improvements can go directly to a pull request.

Do not commit or attach production credentials, access tokens, databases, NetCDF files, proprietary model output, personal information, or private scientific datasets. Use synthetic fixtures that are small, deterministic, and safe to redistribute.

## Development setup

Install Python 3.11+, [uv](https://docs.astral.sh/uv/), Node.js 20+, and pnpm 10. Then follow [SETUP.md](SETUP.md):

```bash
uv sync --frozen
uv run python run.py
```

In a second terminal:

```bash
cd web
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

The bundled mock field is the preferred source for reproducible UI work. Keep imported research data under `data/ionosphere/`; that directory is intentionally ignored by Git.

## Testing changes

Run the smallest relevant test while developing. Examples:

```bash
uv run python -m pytest tests/test_ionosphere_volume.py -q
cd web && node --test tests/volume-layout.test.cjs
```

Before opening a pull request, run the full validation suite:

```bash
uv run python -m pytest -q
uv run ruff check app scripts tests
uv run python scripts/check_public_repo.py
cd web
pnpm type-check
pnpm test
pnpm build
```

Visual changes should include before/after screenshots or a short recording. Scientific changes should document units, coordinate order, interpolation assumptions, missing-data behavior, and the source of expected values.

## Commits and pull requests

Use focused commits with clear, conventional-style messages, for example:

```text
feat: add altitude profile export
fix: preserve missing temporal frames
docs: explain SAMI3 axis normalization
test: cover longitude wraparound
```

A pull request should:

- explain the problem and why the proposed behavior is appropriate;
- link the relevant issue for larger changes;
- include tests for new behavior or bug fixes;
- pass backend, frontend, build, and repository-hygiene checks;
- describe scientific or data-contract effects;
- include visual evidence when the interface changes;
- contain no credentials, runtime databases, private datasets, or generated dependency/build directories.

By contributing, you agree that your contribution is licensed under this repository's MIT License.
