SHELL := /bin/bash
.DEFAULT_GOAL := help

AGENTS_DIR   := agents
MCP_DIR      := mcp_server
WEBAPP_DIR   := webapp/backend

# All Cloud Run service names in deployment order
SERVICES := \
	mcp-server \
	platform-integration \
	issue-detection \
	priority-analysis \
	resource-coordination \
	orchestrator \
	webapp

# Directories that contain agent code (mirrors docker-compose services)
AGENT_PACKAGES := \
	agents/issue_detection \
	agents/priority_analysis \
	agents/resource_coordination \
	agents/platform_integration \
	agents/orchestrator \
	mcp_server \
	webapp/backend

# Cloud Run region (override on command line if needed)
REGION ?= us-central1

.PHONY: help install-dev check lint format test \
        docker-up docker-down build-all \
        deploy-all deploy-service \
        setup-tools setup-gcloud clean

help: ## Print all targets with descriptions
	@echo ""
	@echo "InfraAlert — available make targets"
	@echo "======================================"
	@awk 'BEGIN {FS = ":.*##"; printf ""} \
	      /^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@echo ""
	@echo "Variables you can override on the command line:"
	@echo "  REGION=<gcp-region>    (default: us-central1)"
	@echo "  SERVICE=<name>         (used by deploy-service)"
	@echo ""

install-dev: ## Install all Python deps via uv for all agents + webapp backend
	@echo "==> Installing development dependencies …"
	@which uv > /dev/null 2>&1 || (echo "uv not found — run 'make setup-tools' first" && exit 1)
	uv sync --all-packages
	@echo "==> Done."


check: lint ## Run ruff lint + mypy + pytest across all agents
	@echo "==> Running mypy …"
	uv run mypy $(AGENTS_DIR)/ $(MCP_DIR)/ $(WEBAPP_DIR)/
	@echo "==> Running pytest …"
	uv run pytest $(AGENTS_DIR)/ $(MCP_DIR)/ $(WEBAPP_DIR)/

lint: ## Ruff check agents/ mcp_server/ webapp/backend/
	@echo "==> Ruff lint …"
	uv run ruff check $(AGENTS_DIR)/ $(MCP_DIR)/ $(WEBAPP_DIR)/

format: ## Ruff format agents/ mcp_server/ webapp/backend/
	@echo "==> Ruff format …"
	uv run ruff format $(AGENTS_DIR)/ $(MCP_DIR)/ $(WEBAPP_DIR)/

test: ## Run pytest across agents/ mcp_server/ webapp/backend/
	@echo "==> Running tests …"
	uv run pytest $(AGENTS_DIR)/ $(MCP_DIR)/ $(WEBAPP_DIR)/

docker-up: ## docker compose up --build (starts all local services)
	docker compose up --build

docker-down: ## docker compose down (stops all local services)
	docker compose down

build-all: ## Build all Docker images (iterates SERVICES list)
	@echo "==> Building all service images …"
	@for svc in $(SERVICES); do \
		echo "--- docker build: $$svc ---"; \
		docker compose build $$svc; \
	done
	@echo "==> All images built."

deploy-all: ## Deploy all services to Cloud Run in order
	@echo "==> Deploying all services to Cloud Run (region=$(REGION)) …"
	@for svc in $(SERVICES); do \
		echo "--- Deploying $$svc ---"; \
		$(MAKE) deploy-service SERVICE=$$svc; \
	done
	@echo "==> All services deployed."

deploy-service: ## Deploy a single Cloud Run service  (usage: make deploy-service SERVICE=<name>)
ifndef SERVICE
	$(error SERVICE is not set. Usage: make deploy-service SERVICE=<name>)
endif
	@echo "==> Submitting build for service '$(SERVICE)' …"
	gcloud builds submit \
		--tag gcr.io/$$(gcloud config get-value project)/$(SERVICE):latest \
		$$(case "$(SERVICE)" in \
			mcp-server)             echo "mcp_server/" ;; \
			issue-detection)        echo "agents/issue_detection/" ;; \
			priority-analysis)      echo "agents/priority_analysis/" ;; \
			resource-coordination)  echo "agents/resource_coordination/" ;; \
			platform-integration)   echo "agents/platform_integration/" ;; \
			orchestrator)           echo "agents/orchestrator/" ;; \
			webapp)                 echo "webapp/" ;; \
			*) echo "." ;; \
		esac)
	@echo "==> Deploying '$(SERVICE)' to Cloud Run …"
	gcloud run deploy $(SERVICE) \
		--image gcr.io/$$(gcloud config get-value project)/$(SERVICE):latest \
		--region $(REGION) \
		--platform managed \
		--allow-unauthenticated \
		--env-vars-file .env

setup-tools: ## Install local toolchain (uv; gcloud optional)
	@echo "==> Setting up toolchain …"
	chmod +x scripts/setup-uv.sh scripts/setup-gcloud.sh scripts/setup-env.sh
	bash scripts/setup-uv.sh
	@if command -v gcloud >/dev/null 2>&1; then \
		echo "==> gcloud detected; running Cloud SDK setup …"; \
		bash scripts/setup-gcloud.sh; \
	else \
		echo "==> gcloud not found — skipping Cloud SDK setup (local dev unaffected)."; \
		echo "   Install from: https://cloud.google.com/sdk/docs/install"; \
		echo "   Then run: make setup-gcloud"; \
	fi
	@echo "==> Toolchain setup complete."

setup-gcloud: ## Configure Google Cloud CLI/auth for deployment tasks
	@echo "==> Running Cloud SDK setup …"
	chmod +x scripts/setup-gcloud.sh
	bash scripts/setup-gcloud.sh

clean: ## Remove __pycache__, .pytest_cache, dist directories
	@echo "==> Cleaning build artefacts …"
	find . -type d -name __pycache__    -not -path './.git/*' -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name .pytest_cache  -not -path './.git/*' -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name dist           -not -path './.git/*' -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name .mypy_cache    -not -path './.git/*' -exec rm -rf {} + 2>/dev/null || true
	find . -name '*.pyc' -delete 2>/dev/null || true
	@echo "==> Clean done."
