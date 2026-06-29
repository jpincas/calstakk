# CalStakk — Makefile
#
# `make check` is the single source of truth for "is the repo clean?"
# It is what pre-commit hooks and Claude Code Stop hooks invoke.

APP ?= calstakk

GO_PKGS := ./cmd/... ./internal/...

.PHONY: check check-fast check-race tidy-check build test test-race lint iterate stop run

# ---------------------------------------------------------------------------
# The gate
# ---------------------------------------------------------------------------

check: lint tidy-check build test
	@echo "✓ check passed"

check-race: lint tidy-check build test-race
	@echo "✓ check-race passed"

# Stop-hook gate: cheap subset that catches silent agent drift.
check-fast: lint build
	@echo "✓ check-fast passed"

# ---------------------------------------------------------------------------
# Build / test / lint (Go)
# ---------------------------------------------------------------------------

build:
	go build $(GO_PKGS)

test:
	go test -count=1 -timeout 120s $(GO_PKGS)

test-race:
	go test -count=1 -race -timeout 120s $(GO_PKGS)

lint:
	golangci-lint run $(GO_PKGS)

tidy-check:
	go mod tidy
	@if ! git diff --quiet -- go.mod go.sum; then \
		echo "✗ go.mod / go.sum out of date — run 'go mod tidy' and commit"; \
		git diff --name-only -- go.mod go.sum | sed 's/^/  M  /'; \
		exit 1; \
	fi

# ---------------------------------------------------------------------------
# Web UI
# ---------------------------------------------------------------------------

web-install:
	cd web && npm install

web-build:
	cd web && npm run build

web-dev:
	cd web && npm run dev

# ---------------------------------------------------------------------------
# Dev
# ---------------------------------------------------------------------------

iterate:
	go build ./cmd/calstakk

stop:
	pkill -f './bin/calstakk' || true
	pkill -f 'go run ./cmd/calstakk' || true

run:
	go run ./cmd/calstakk serve
