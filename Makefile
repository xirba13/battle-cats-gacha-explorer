# Convenience targets. On Windows without `make`, use docker-compose (see README)
# or run the underlying commands directly.

PY := backend/.venv/Scripts/python.exe   # Windows venv layout
ifeq (,$(wildcard $(PY)))
PY := backend/.venv/bin/python            # POSIX venv layout
endif

.PHONY: dev up down install backend frontend test icons clean

## Run backend + frontend together in containers (recommended, cross-platform)
dev: up
up:
	docker compose up --build

down:
	docker compose down

## Local (non-Docker) setup — needs Python 3.11 and Node 20 + pnpm
install:
	python -m venv backend/.venv
	$(PY) -m pip install --upgrade pip
	$(PY) -m pip install -r backend/requirements.txt
	cd frontend && pnpm install

## Run the backend dev server (http://localhost:8000)
backend:
	cd backend && .venv/Scripts/uvicorn app.main:app --reload --port 8000 \
		|| cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000

## Run the frontend dev server (http://localhost:5173, proxies /api -> :8000)
frontend:
	cd frontend && pnpm dev

## Download unit icons locally into frontend/public/icons (offline rendering)
icons:
	$(PY) scrapers/download_icons.py

## Run the backend test suite
test:
	cd backend && .venv/Scripts/python.exe -m pytest \
		|| cd backend && .venv/bin/python -m pytest

clean:
	rm -rf backend/var/*.sqlite backend/var/godfat_cache frontend/dist
