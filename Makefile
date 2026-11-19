GO ?= go
YARN ?= yarn
PACKAGES = ./cmd/... ./internal/... ./web ./deploy

.PHONY: build web check fmt-check vet test web-check e2e install clean

build: web
	mkdir -p dist
	$(GO) build -trimpath -buildvcs=false -ldflags '-s -w' -o dist/agent-hub ./cmd/agent-hub

web:
	cd web && $(YARN) install --immutable && $(YARN) build

fmt-check:
	@test -z "$$(gofmt -l cmd internal web/embed.go deploy/deploy.go)" || { gofmt -l cmd internal web/embed.go deploy/deploy.go; exit 1; }

vet:
	$(GO) vet $(PACKAGES)

test:
	$(GO) test ./internal/...

web-check:
	cd web && $(YARN) check

check: fmt-check vet test web-check

# End-to-end tests of the web app against a hub of their own in a scratch home, with a stand-in agent.
e2e: build
	cd web && $(YARN) e2e

# The binary carries everything else and installs it; `agent-hub install` alone does the same on another machine.
install: build
	dist/agent-hub install

clean:
	rm -rf dist web/dist
