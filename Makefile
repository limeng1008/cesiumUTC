.PHONY: help install start test lint format frontend-check check migrate upgrade

help:
	@printf '%s\n' \
		'install         Install locked Python and frontend dependencies' \
		'start           Start the local FastAPI server' \
		'test            Run backend tests' \
		'lint            Run Python lint checks' \
		'format          Format Python source and tests' \
		'frontend-check  Type-check, test, and build the frontend' \
		'check           Run the complete local validation suite'

install:
	uv sync --frozen
	cd web && corepack enable && pnpm install --frozen-lockfile

start:
	uv run python run.py

test:
	uv run python -m pytest -q

lint:
	uv run ruff check app scripts tests

format:
	uv run black app scripts tests
	uv run isort app scripts tests --profile black

frontend-check:
	cd web && pnpm run ci

check: test lint frontend-check
	uv run python scripts/check_public_repo.py

migrate:
	uv run aerich migrate

upgrade:
	uv run aerich upgrade
