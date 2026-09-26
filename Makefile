SHELL := /bin/bash
.DEFAULT_GOAL := help

BACKEND_DIR  := webapp/backend
FRONTEND_DIR := webapp/frontend

# Database the backend tests create their throwaway databases on (`make db-up`).
TEST_DATABASE_URL ?= postgresql+psycopg://infraalert:infraalert@localhost:5433/infraalert

# ---- Deployment (see docs/deploy.md for the one-time setup) -------------------
PROJECT      ?= $(shell gcloud config get-value project 2>/dev/null)
REGION       ?= us-central1
SERVICE      ?= infraalert
MIGRATE_JOB  ?= $(SERVICE)-migrate
AR_REPO      ?= infraalert
TAG          ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo latest)
IMAGE        ?= $(REGION)-docker.pkg.dev/$(PROJECT)/$(AR_REPO)/$(SERVICE):$(TAG)
# Frontend build settings, passed through from the environment into the image.
VITE_VARS := VITE_MAPTILER_KEY VITE_TURNSTILE_SITE_KEY VITE_MAP_DEFAULT_CENTER \
             VITE_EMERGENCY_NUMBER VITE_STAFF_AUTH VITE_FIREBASE_API_KEY \
             VITE_FIREBASE_AUTH_DOMAIN VITE_FIREBASE_PROJECT_ID VITE_STAFF_SIGN_IN_PROVIDER

.PHONY: help env install-dev lint format check test test-backend test-frontend \
        db-up db-migrate db-revision seed-dev dev docker-up docker-down \
        image deploy-migrate deploy setup-tools setup-gcloud clean

help: ## Print all targets with descriptions
	@echo ""
	@echo "InfraAlert — available make targets"
	@echo "===================================="
	@awk 'BEGIN {FS = ":.*##"} \
	      /^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@echo ""
	@echo "Deploy variables: PROJECT REGION SERVICE MIGRATE_JOB AR_REPO TAG IMAGE"
	@echo ""

env: ## Create .env from .env.example (if it doesn't exist)
	bash scripts/setup-env.sh

install-dev: ## Install backend (uv) and frontend (npm) dependencies
	@which uv > /dev/null 2>&1 || (echo "uv not found — run 'make setup-tools' first" && exit 1)
	uv sync --all-packages --all-extras
	cd $(FRONTEND_DIR) && npm install

lint: ## Ruff lint the backend
	uvx ruff check $(BACKEND_DIR)/

format: ## Ruff format the backend (and fix import order)
	uvx ruff check --select I --fix $(BACKEND_DIR)/
	uvx ruff format $(BACKEND_DIR)/

check: lint ## Lint + mypy + all tests
	uv run --with mypy mypy $(BACKEND_DIR)/infraalert
	@$(MAKE) --no-print-directory test

test: test-backend test-frontend ## Run backend pytest and frontend vitest

test-backend: ## Backend pytest (DB tests use TEST_DATABASE_URL; run `make db-up` first)
	TEST_DATABASE_URL='$(TEST_DATABASE_URL)' uv run pytest -q

test-frontend: ## Frontend vitest
	cd $(FRONTEND_DIR) && npm test

db-up: ## Start only the PostGIS database (localhost:5433)
	docker compose up -d --wait db

db-migrate: db-up ## Apply all migrations to the local database
	cd $(BACKEND_DIR) && uv run alembic upgrade head

db-revision: db-up ## Autogenerate a migration  (usage: make db-revision MSG="add x")
ifndef MSG
	$(error MSG is not set. Usage: make db-revision MSG="describe the change")
endif
	cd $(BACKEND_DIR) && uv run alembic revision --autogenerate -m "$(MSG)"

seed-dev: ## Add the development staff, teams and sensitive places (needs .env)
	@test -f .env || (echo ".env not found — run 'make env' first" && exit 1)
	uv run --env-file .env python -m infraalert.cli seed-dev

# Both servers run from the repo root, so var/ (uploads, outbox) lands in ./var.
# Ctrl-C stops both.
dev: ## Backend on :8000 (auto-reload) + Vite dev server on :5173
	@test -f .env || (echo ".env not found — run 'make env' first" && exit 1)
	@trap 'kill 0' INT TERM EXIT; \
	uv run uvicorn main:app --app-dir $(BACKEND_DIR) --reload --reload-dir $(BACKEND_DIR) \
		--port 8000 & \
	(cd $(FRONTEND_DIR) && npm run dev -- --port 5173 --strictPort) & \
	wait

docker-up: ## Build and run db + app in Docker (http://localhost:8000)
	docker compose up --build

docker-down: ## Stop the Docker stack
	docker compose down

image: ## Build and push the service image to Artifact Registry (IMAGE=...)
	@test -n "$(PROJECT)" || (echo "PROJECT is not set (gcloud config set project …)" && exit 1)
	docker build --platform linux/amd64 -f webapp/Dockerfile \
		$(foreach v,$(VITE_VARS),--build-arg $(v)) -t $(IMAGE) .
	docker push $(IMAGE)

deploy-migrate: ## Run migrations as the Cloud Run job MIGRATE_JOB with IMAGE
	gcloud run jobs update $(MIGRATE_JOB) --image $(IMAGE) --region $(REGION)
	gcloud run jobs execute $(MIGRATE_JOB) --region $(REGION) --wait

deploy: image deploy-migrate ## Build, push, migrate, then roll out the Cloud Run service
	gcloud run deploy $(SERVICE) --image $(IMAGE) --region $(REGION)

setup-tools: ## Install local toolchain (uv; gcloud optional)
	bash scripts/setup-uv.sh
	@if command -v gcloud >/dev/null 2>&1; then \
		bash scripts/setup-gcloud.sh; \
	else \
		echo "==> gcloud not found — skipping (only needed to deploy)."; \
		echo "   Install from: https://cloud.google.com/sdk/docs/install"; \
	fi

setup-gcloud: ## Configure Google Cloud CLI/auth for deployment
	bash scripts/setup-gcloud.sh

clean: ## Remove Python caches and the frontend build
	find . -type d \( -name __pycache__ -o -name .pytest_cache -o -name .mypy_cache \) \
		-not -path './.git/*' -not -path '*/node_modules/*' -exec rm -rf {} + 2>/dev/null || true
	rm -rf $(FRONTEND_DIR)/dist
