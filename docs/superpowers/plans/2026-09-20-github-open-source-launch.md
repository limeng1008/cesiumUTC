# CesiumUTC GitHub Open-Source Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish CesiumUTC as a clean, English-first, visually compelling, reproducible open-source project at `https://github.com/limeng1008/cesiumUTC`.

**Architecture:** Keep the existing FastAPI, Vue 3, Pinia, Naive UI, and Cesium architecture intact. The launch work is split into a small UI correction, a tracked-file safety gate, English-first documentation and community files, deterministic CI, curated screenshots/animation, and a final audited push. Generated datasets and local runtime state stay outside Git; only deterministic mock behavior and documentation enter the repository.

**Tech Stack:** Python 3.11+, FastAPI, pytest, Vue 3, TypeScript, Node 20, pnpm 10, Cesium 1.133, Node test runner, GitHub Actions, Playwright CLI, FFmpeg.

---

## File map

**Modify**

- `web/src/views/ionosphere/volume/index.vue` — remove the lower-left scene caption and its unused computed state.
- `web/src/views/ionosphere/volume/volume.scss` — let the desktop scene shrink to available height while retaining a usable mobile height.
- `.gitignore` and `.dockerignore` — exclude databases, datasets, caches, generated media, local plans, and build output.
- `pyproject.toml` — publish CesiumUTC metadata and declare the pytest development dependency.
- `README.md` — English default GitHub landing page.
- `SETUP.md` — English reproducible setup and troubleshooting guide.
- `LICENSE` — retain the upstream MIT notice and add the CesiumUTC modification copyright line without deleting upstream rights.
- `web/package.json` — add a single CI command that composes type-check, tests, and build.

**Create**

- `web/tests/volume-layout.test.cjs` — regression tests for caption removal and short-window layout behavior.
- `scripts/check_public_repo.py` — audit Git-tracked paths, file sizes, and prohibited public artifacts.
- `tests/test_public_repo.py` — unit tests for the tracked-file audit rules.
- `NOTICE` — upstream attribution and Cesium/Cesium ion attribution note.
- `README.zh-CN.md` — secondary Chinese landing page.
- `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md` — community and release policy.
- `.github/workflows/ci.yml` — backend, frontend, and repository hygiene checks.
- `.github/ISSUE_TEMPLATE/bug_report.yml` and `.github/ISSUE_TEMPLATE/feature_request.yml` — structured issue intake.
- `.github/pull_request_template.md` — verification checklist for contributions.
- `docs/assets/hero-ionosphere.png`, `docs/assets/global-overview.png`, and `docs/assets/analysis-view.png` — curated static screenshots.
- `docs/assets/cesiumutc-demo.gif` and `docs/assets/cesiumutc-demo.mp4` — lightweight README animation and higher-quality linked walkthrough.

**Remove from the public project**

- `README-en.md` — obsolete after `README.md` becomes English.
- `.gitignore 2` — cloud-sync conflict copy.
- Local-only `findings.md`, `progress.md`, and `task_plan.md` from the public tracking set; keep them locally ignored.

---

### Task 1: Fix the release-blocking ionosphere layout

**Files:**

- Create: `web/tests/volume-layout.test.cjs`
- Modify: `web/src/views/ionosphere/volume/index.vue`
- Modify: `web/src/views/ionosphere/volume/volume.scss`

- [ ] **Step 1: Write the failing structural regression tests**

Create `web/tests/volume-layout.test.cjs`:

```js
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const view = fs.readFileSync(path.join(root, 'src/views/ionosphere/volume/index.vue'), 'utf8')
const styles = fs.readFileSync(path.join(root, 'src/views/ionosphere/volume/volume.scss'), 'utf8')

test('volume scene omits the redundant lower-left caption', () => {
  assert.doesNotMatch(view, /class="volume-caption"/)
  assert.doesNotMatch(view, /visibilityCaption|regionCaption/)
})

test('desktop volume viewport may shrink while mobile keeps a usable scene height', () => {
  assert.match(styles, /\.volume-viewport\s*\{[^}]*min-height:\s*0;/s)
  assert.doesNotMatch(styles, /\.volume-caption\s*\{/)
  assert.match(
    styles,
    /@media \(max-width: 680px\)[\s\S]*?\.volume-viewport\s*\{[^}]*min-height:\s*360px;/
  )
})
```

- [ ] **Step 2: Run the test and confirm the current code fails**

Run:

```bash
cd web
node --test tests/volume-layout.test.cjs
```

Expected: two failures because the caption and desktop `min-height: 360px` still exist.

- [ ] **Step 3: Remove the caption and dead computed values**

In `web/src/views/ionosphere/volume/index.vue`:

1. Delete the `<div class="volume-caption">...</div>` block.
2. Change `import { computed, ref } from 'vue'` to `import { ref } from 'vue'`.
3. Delete the complete `visibilityCaption` and `regionCaption` computed declarations.

The script footer must end with only the active setup:

```js
const scene = ref(null),
  store = useVolumeStore(),
  route = useRoute()
const debug = import.meta.env.DEV && route.query.debugIonosphere === '1'
```

- [ ] **Step 4: Make the viewport height responsive to available desktop space**

In `web/src/views/ionosphere/volume/volume.scss`, change the base viewport rule and delete both `.volume-caption` rules:

```scss
.volume-viewport {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
}
```

Inside the existing `@media (max-width: 680px)` block add:

```scss
.volume-viewport {
  flex: 0 0 360px;
  min-height: 360px;
}
```

- [ ] **Step 5: Run focused and full frontend verification**

Run:

```bash
cd web
node --test tests/volume-layout.test.cjs
pnpm type-check
pnpm test
```

Expected: the focused file reports 2 passing tests; type-check and the complete Node suite exit 0.

- [ ] **Step 6: Verify both target viewport sizes visually**

Use the Playwright CLI wrapper:

```bash
export PWCLI="/Users/Zhuanz/.codex/skills/playwright/scripts/playwright_cli.sh"
"$PWCLI" --session cesiumutc open http://127.0.0.1:3100/ionosphere --headed
"$PWCLI" --session cesiumutc resize 1512 861
"$PWCLI" --session cesiumutc snapshot
"$PWCLI" --session cesiumutc resize 1512 650
"$PWCLI" --session cesiumutc snapshot
```

Expected at both sizes: no three-line lower-left caption; the scene, legend, status row, and application footer remain visible without overlap.

- [ ] **Step 7: Commit the UI fix**

```bash
git add web/src/views/ionosphere/volume/index.vue web/src/views/ionosphere/volume/volume.scss web/tests/volume-layout.test.cjs
git commit -m "fix: keep ionosphere viewport fully visible"
```

---

### Task 2: Add repository hygiene enforcement and project metadata

**Files:**

- Create: `scripts/check_public_repo.py`
- Create: `tests/test_public_repo.py`
- Create: `NOTICE`
- Modify: `.gitignore`
- Modify: `.dockerignore`
- Modify: `pyproject.toml`
- Modify: `LICENSE`

- [ ] **Step 1: Write failing audit-rule unit tests**

Create `tests/test_public_repo.py`:

```python
from scripts.check_public_repo import forbidden_reason


def test_rejects_runtime_and_scientific_data():
    assert forbidden_reason("db.sqlite3", 100) == "database/runtime file"
    assert forbidden_reason("data/ionosphere/run/source.nc", 100) == "scientific dataset"
    assert forbidden_reason("web/node_modules/vue/index.js", 100) == "generated dependency/build path"


def test_rejects_oversized_files():
    assert forbidden_reason("docs/assets/demo.mp4", 10 * 1024 * 1024 + 1) == "file exceeds 10 MiB"


def test_allows_source_and_small_curated_media():
    assert forbidden_reason("app/api/v1/cesium/__init__.py", 100) is None
    assert forbidden_reason("docs/assets/hero-ionosphere.png", 2 * 1024 * 1024) is None
```

- [ ] **Step 2: Run the test and confirm it fails because the audit module is absent**

Run:

```bash
uv run python -m pytest tests/test_public_repo.py -q
```

Expected: collection error for `scripts.check_public_repo`.

- [ ] **Step 3: Implement the public-repository audit**

Create `scripts/check_public_repo.py`:

```python
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
    if lower_name.endswith((".sqlite3", ".sqlite3-shm", ".sqlite3-wal")):
        return "database/runtime file"
    if lower_name.endswith((".nc", ".nc4")):
        return "scientific dataset"
    if lower_name in {".env", ".env.local"}:
        return "private environment file"
    return None


def tracked_files(root: Path) -> list[str]:
    output = subprocess.check_output(
        ["git", "ls-files", "-z"], cwd=root, text=True
    )
    return [item for item in output.split("\0") if item]


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
```

- [ ] **Step 4: Expand ignore rules**

Append the following exact entries to `.gitignore`, removing duplicates where present:

```gitignore
# Local agent and browser artifacts
.superpowers/
.playwright-cli/
output/
findings.md
progress.md
task_plan.md
.gitignore 2

# Runtime databases and research data
*.sqlite3
*.sqlite3-*
*.sqlite3.backup-*
*.nc
*.nc4
data/ionosphere/

# Frontend dependencies and generated assets
web/node_modules/
web/dist/
web/public/cesium/
web/stats.html
```

Make `.dockerignore` contain these release-safe patterns in addition to its existing dependency rule:

```dockerignore
.git
.github
.superpowers
.playwright-cli
.venv
node_modules
web/node_modules
web/dist
output
data/ionosphere
*.sqlite3*
*.nc
*.nc4
```

- [ ] **Step 5: Update package identity and attribution**

Change the `pyproject.toml` project header to:

```toml
[project]
name = "cesiumutc"
version = "0.1.0"
description = "Open-source 3D ionosphere analysis and scientific visualization platform"
authors = [{ name = "limeng1008" }]
requires-python = ">=3.11"

[project.urls]
Homepage = "https://github.com/limeng1008/cesiumUTC"
Repository = "https://github.com/limeng1008/cesiumUTC"
Issues = "https://github.com/limeng1008/cesiumUTC/issues"

[dependency-groups]
dev = ["pytest>=8.4,<9"]
```

Keep every existing dependency and tool section unchanged. In `LICENSE`, retain the upstream copyright line and add:

```text
Modifications copyright (c) 2026 limeng1008
```

Create `NOTICE`:

```text
CesiumUTC
Copyright (c) 2026 limeng1008

This project is based on vue-fastapi-admin by mizhexiaoxiao and preserves its
MIT License and copyright notice.

CesiumJS is licensed separately by Cesium GS, Inc. This repository does not
remove or obscure CesiumJS or Cesium ion attribution displayed by the runtime.
```

- [ ] **Step 6: Run the hygiene tests**

```bash
uv run python -m pytest tests/test_public_repo.py -q
uv run python scripts/check_public_repo.py
```

Expected: 3 tests pass and the tracked-file audit prints `Public repository audit passed.`

- [ ] **Step 7: Commit hygiene and metadata**

```bash
git add .gitignore .dockerignore pyproject.toml LICENSE NOTICE scripts/check_public_repo.py tests/test_public_repo.py
git commit -m "chore: prepare repository for public release"
```

---

### Task 3: Replace upstream documentation with an English-first project story

**Files:**

- Modify: `README.md`
- Create: `README.zh-CN.md`
- Modify: `SETUP.md`
- Remove: `README-en.md`

- [ ] **Step 1: Replace `README.md` with the English landing-page structure**

Use this exact top section and retain the heading order below it:

```markdown
<div align="center">

# CesiumUTC

### Open-source 3D ionosphere analysis and scientific visualization

[![CI](https://github.com/limeng1008/cesiumUTC/actions/workflows/ci.yml/badge.svg)](https://github.com/limeng1008/cesiumUTC/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python 3.11+](https://img.shields.io/badge/Python-3.11%2B-3776AB.svg)](https://www.python.org/)
[![Vue 3](https://img.shields.io/badge/Vue-3-42b883.svg)](https://vuejs.org/)
[![CesiumJS](https://img.shields.io/badge/CesiumJS-1.133-6CADDF.svg)](https://cesium.com/platform/cesiumjs/)

[Quick start](#quick-start) · [Features](#features) · [Architecture](#architecture) · [Data formats](#data-formats) · [中文](README.zh-CN.md)

![CesiumUTC regional multi-altitude ionosphere slices](docs/assets/hero-ionosphere.png)

CesiumUTC turns multidimensional ionosphere data into an explorable 3D globe.
It combines native Cesium GPU voxels, geodetic altitude slices, spatial probes,
vertical sections, temporal analysis, and SAMI3 NetCDF ingestion in one
reproducible FastAPI + Vue application.

![CesiumUTC interactive walkthrough](docs/assets/cesiumutc-demo.gif)

[Watch the higher-quality MP4 walkthrough](docs/assets/cesiumutc-demo.mp4)

</div>
```

Continue with these sections, using only claims already supported by the repository:

```markdown
## Why CesiumUTC
## Features
## Screenshots
## Architecture
## Quick start
### Requirements
### Backend
### Frontend
## Data formats
## Validation
## Scientific scope and limitations
## Roadmap
## Contributing
## Security
## License and acknowledgements
```

The Quick start commands must be exactly:

```bash
git clone https://github.com/limeng1008/cesiumUTC.git
cd cesiumUTC
uv sync --frozen
uv run python run.py
```

and in a second terminal:

```bash
cd web
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

State that the default local development login inherited from the upstream scaffold is `admin` / `123456`, must be changed outside local development, and is not a production credential.

- [ ] **Step 2: Create the Chinese secondary README**

Create `README.zh-CN.md` with the same section order, the same commands, the same media paths, and an English link at the top:

```markdown
[English](README.md) | 简体中文

# CesiumUTC

开源三维电离层分析与科学可视化平台。
```

Translate all feature descriptions faithfully; do not add unsupported real-time data, forecast accuracy, or observational-data claims.

- [ ] **Step 3: Rewrite `SETUP.md` in English**

Include these exact operational headings:

```markdown
# Local setup and validation
## Prerequisites
## Backend
## Frontend
## Default development account
## Optional SAMI3 import
## Build
## Test
## Troubleshooting
```

Document `uv sync --frozen`, `uv run python run.py`, `pnpm install --frozen-lockfile`, `pnpm dev`, `pnpm test`, `pnpm type-check`, `pnpm build`, WebGL2 requirements, localhost URLs, and the mock-data fallback.

- [ ] **Step 4: Remove the obsolete upstream English file and check links**

Delete `README-en.md`. Run:

```bash
rg -n "mizhexiaoxiao/vue-fastapi-admin|README-en\.md|47\.111\.|139\.9\." README.md README.zh-CN.md SETUP.md
```

Expected: only the deliberate upstream acknowledgement remains; no obsolete README name or old demo IP remains.

- [ ] **Step 5: Commit the product documentation**

```bash
git add README.md README.zh-CN.md SETUP.md
git commit -m "docs: publish English-first project documentation"
```

---

### Task 4: Add community health files and contribution paths

**Files:**

- Create: `CONTRIBUTING.md`
- Create: `SECURITY.md`
- Create: `CODE_OF_CONDUCT.md`
- Create: `CHANGELOG.md`
- Create: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Create: `.github/ISSUE_TEMPLATE/feature_request.yml`
- Create: `.github/pull_request_template.md`

- [ ] **Step 1: Add contribution and security guidance**

`CONTRIBUTING.md` must cover environment setup, focused tests, full validation, scientific-data privacy, issue-first behavior for large changes, conventional commit examples, and the pull-request checklist.

`SECURITY.md` must contain:

```markdown
# Security policy

## Supported versions

Security fixes target the latest revision of the `main` branch.

## Reporting a vulnerability

Do not open a public issue for an unpatched vulnerability. Use GitHub's private
security advisory flow for this repository. Include affected versions,
reproduction steps, impact, and any suggested mitigation. Maintainers will
acknowledge a complete report within seven days.

Never attach production credentials, private scientific datasets, access
tokens, database snapshots, or personal information to an issue or advisory.
```

- [ ] **Step 2: Add conduct and changelog files**

Use the Contributor Covenant 2.1 text in `CODE_OF_CONDUCT.md`, with the repository's GitHub private reporting route as the enforcement contact. Create `CHANGELOG.md` using Keep a Changelog structure with an `Unreleased` section and `0.1.0 - 2026-09-20` entries for 3D volume rendering, slices, probes, sections, analysis, SAMI3 import, and open-source launch.

- [ ] **Step 3: Add structured issue templates**

`bug_report.yml` must request environment, browser/GPU, data source (`mock` or `SAMI3`), reproduction, expected behavior, actual behavior, logs with secrets removed, and screenshots.

`feature_request.yml` must request the scientific/user problem, proposed workflow, alternatives, data requirements, and acceptance criteria.

Both templates must warn users not to upload credentials or private datasets.

- [ ] **Step 4: Add the pull-request template**

Create `.github/pull_request_template.md`:

```markdown
## Summary

## Why this change

## Validation

- [ ] `uv run python -m pytest -q`
- [ ] `cd web && pnpm type-check`
- [ ] `cd web && pnpm test`
- [ ] `cd web && pnpm build`
- [ ] `uv run python scripts/check_public_repo.py`
- [ ] Visual changes include before/after evidence
- [ ] No credentials, databases, or private datasets are included

## Screenshots or recordings

## Scientific/data impact
```

- [ ] **Step 5: Commit the community files**

```bash
git add CONTRIBUTING.md SECURITY.md CODE_OF_CONDUCT.md CHANGELOG.md .github/ISSUE_TEMPLATE .github/pull_request_template.md
git commit -m "docs: add open-source community guidelines"
```

---

### Task 5: Add deterministic GitHub Actions validation

**Files:**

- Create: `.github/workflows/ci.yml`
- Modify: `web/package.json`

- [ ] **Step 1: Add a single frontend CI script**

Add this entry to `web/package.json` scripts:

```json
"ci": "pnpm type-check && pnpm test && pnpm build"
```

- [ ] **Step 2: Create the CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v6
        with:
          enable-cache: true
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - run: uv sync --frozen
      - run: uv run python -m pytest -q
      - run: uv run python scripts/check_public_repo.py

  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
          cache-dependency-path: web/pnpm-lock.yaml
      - working-directory: web
        run: pnpm install --frozen-lockfile
      - working-directory: web
        run: pnpm ci
```

- [ ] **Step 3: Execute the same commands locally**

```bash
uv sync --frozen
uv run python -m pytest -q
uv run python scripts/check_public_repo.py
cd web
pnpm install --frozen-lockfile
pnpm ci
```

Expected: every command exits 0. If a pre-existing test fails, diagnose it before changing CI; do not weaken or skip the test.

- [ ] **Step 4: Commit CI**

```bash
git add .github/workflows/ci.yml web/package.json
git commit -m "ci: validate backend frontend and repository hygiene"
```

---

### Task 6: Capture and optimize the GitHub media set

**Files:**

- Create: `docs/assets/hero-ionosphere.png`
- Create: `docs/assets/global-overview.png`
- Create: `docs/assets/analysis-view.png`
- Create: `docs/assets/cesiumutc-demo.gif`
- Create: `docs/assets/cesiumutc-demo.mp4`

- [ ] **Step 1: Start a clean local demo environment**

Run backend and frontend in separate terminal sessions:

```bash
uv run python run.py
```

```bash
cd web
pnpm dev
```

Confirm `http://127.0.0.1:3100/ionosphere` loads with deterministic mock data.

- [ ] **Step 2: Capture static screenshots at one consistent viewport**

Use the Playwright CLI wrapper and a 1600 × 900 viewport:

```bash
export PWCLI="/Users/Zhuanz/.codex/skills/playwright/scripts/playwright_cli.sh"
"$PWCLI" --session release-media open http://127.0.0.1:3100/ionosphere --headed
"$PWCLI" --session release-media resize 1600 900
"$PWCLI" --session release-media snapshot
```

Log in with the documented local development account only if redirected. Capture, in order:

1. Shandong oblique multi-altitude slices for `hero-ionosphere.png`.
2. Global 3D overview for `global-overview.png`.
3. The most information-dense temporal or data-analysis view for `analysis-view.png`.

After every navigation or major control change, run `snapshot` again before interacting. Run `screenshot`, note the exact output PNG path it prints, and copy that explicit file to the matching `docs/assets/` filename.

- [ ] **Step 3: Capture six real UI states for the walkthrough**

Store temporary frames only under `output/playwright/release-media/` and name them sequentially:

```text
frame-01.png — overview
frame-02.png — oblique regional view
frame-03.png — single slice
frame-04.png — multiple slices
frame-05.png — spatial probe
frame-06.png — vertical section
```

Each frame must come from the running application after the corresponding interaction; do not fabricate scientific output or use generated artwork.

- [ ] **Step 4: Produce optimized MP4 and GIF assets**

Run:

```bash
ffmpeg -y -framerate 0.6 -i output/playwright/release-media/frame-%02d.png -vf "scale=1280:-2:flags=lanczos,format=yuv420p" -c:v libx264 -crf 23 -movflags +faststart docs/assets/cesiumutc-demo.mp4
ffmpeg -y -i docs/assets/cesiumutc-demo.mp4 -vf "fps=8,scale=960:-2:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3" docs/assets/cesiumutc-demo.gif
```

- [ ] **Step 5: Optimize screenshots and enforce media size limits**

For each screenshot run the same scale pass, substituting the explicit source and destination path:

```bash
ffmpeg -y -i docs/assets/hero-ionosphere.png -vf "scale='min(1600,iw)':-2:flags=lanczos" -compression_level 9 docs/assets/hero-ionosphere.optimized.png
```

Replace the source with the optimized output using `apply_patch`-safe file handling or an explicit rename after visual verification. Then run:

```bash
find docs/assets -type f -size +10M -print
```

Expected: no output. Verify every asset visually and confirm the hero contains no obsolete caption, clipped scene, credential, or private dataset identifier.

- [ ] **Step 6: Commit curated media**

```bash
git add docs/assets/hero-ionosphere.png docs/assets/global-overview.png docs/assets/analysis-view.png docs/assets/cesiumutc-demo.gif docs/assets/cesiumutc-demo.mp4
git commit -m "docs: add CesiumUTC visual showcase"
```

---

### Task 7: Run release verification and stage only public-safe files

**Files:**

- Verify all tracked and staged files.

- [ ] **Step 1: Run backend verification**

```bash
uv run python -m pytest -q
uv run ruff check app scripts tests
```

Expected: all tests pass and Ruff exits 0.

- [ ] **Step 2: Run frontend verification**

```bash
cd web
pnpm type-check
pnpm test
pnpm build
```

Expected: all commands exit 0 and Vite produces `web/dist` without fatal warnings.

- [ ] **Step 3: Stage the intended source tree, then audit the exact index**

From the repository root:

```bash
git add .
uv run python scripts/check_public_repo.py
git status --short
git diff --cached --check
```

Review `git status --short` line by line. The staged list must not contain databases, `.nc`/`.nc4`, `.env`, `.venv`, `node_modules`, `output`, `.playwright-cli`, `.superpowers`, `findings.md`, `progress.md`, or `task_plan.md`.

- [ ] **Step 4: Scan staged text for likely credentials and obsolete branding**

```bash
git grep --cached -n -I -E "(BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,})"
git grep --cached -n -I -E "Vue FastAPI Admin Logo|47\.111\.|139\.9\."
```

Expected: no matches. Deliberate upstream acknowledgements to `vue-fastapi-admin` are allowed; obsolete branding and live demo IPs are not.

- [ ] **Step 5: Create the public source commit**

```bash
git commit -m "feat: publish CesiumUTC open-source platform"
```

- [ ] **Step 6: Re-run the tracked-file audit after commit**

```bash
uv run python scripts/check_public_repo.py
git status --short
```

Expected: audit passes. Only ignored local runtime files may remain; there are no uncommitted public-source changes.

---

### Task 8: Push the audited release to GitHub and verify the landing page

**Files:**

- No source changes expected unless GitHub rendering reveals a broken relative link.

- [ ] **Step 1: Confirm the destination is still empty and configure the remote**

```bash
git ls-remote https://github.com/limeng1008/cesiumUTC.git
git remote remove origin 2>/dev/null || true
git remote add origin https://github.com/limeng1008/cesiumUTC.git
git remote -v
```

Expected before push: `ls-remote` prints no refs; both fetch and push remotes point to the supplied repository.

- [ ] **Step 2: Push `main`**

```bash
git branch -M main
git push -u origin main
```

Expected: Git reports a new `main` branch on `origin`. If authentication is unavailable, stop here without altering credentials and report the exact user action needed.

- [ ] **Step 3: Verify the public repository read-only**

Open `https://github.com/limeng1008/cesiumUTC` and confirm:

- README is English by default.
- Hero screenshot and animation render.
- CI badge links to the workflow.
- Chinese README link works.
- License, contribution, security, and issue templates are visible.
- No database, private dataset, environment file, or local artifact appears in the tree.

- [ ] **Step 4: Wait for CI and fix only evidence-backed failures**

Inspect the GitHub Actions run. If a job fails, reproduce its exact command locally, diagnose the root cause, add a regression test when applicable, commit the minimal fix, and push again. Do not disable checks or mark failures as allowed.

- [ ] **Step 5: Record the release result**

Report the public repository URL, pushed commit SHA, local verification commands and results, CI status, and any GitHub repository settings still requiring owner-side configuration (description, topics, social preview, or Pages).
