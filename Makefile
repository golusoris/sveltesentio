.PHONY: setup dev build lint typecheck test ci clean

# Bootstrap dev environment (run once after cloning)
setup:
	corepack enable
	pnpm install
	pnpm husky init || true
	@echo "Setup complete. Run 'make dev' to start development."

# Start all packages in dev/watch mode
dev:
	pnpm dev

# Build all packages
build:
	pnpm build

# Lint all packages
lint:
	pnpm lint

# Type-check all packages
typecheck:
	pnpm typecheck

# Run all unit tests
test:
	pnpm test

# Run E2E tests
test-e2e:
	pnpm test:e2e

# Full CI suite (matches GitHub Actions)
# NB: `pnpm run ci`, not `pnpm ci` — the latter is pnpm's clean-install alias.
ci:
	pnpm run ci

# Format all files
fmt:
	pnpm format

# Check formatting without writing
fmt-check:
	pnpm format:check

# Remove all build artifacts
clean:
	find . -name 'dist' -not -path '*/node_modules/*' -exec rm -rf {} + 2>/dev/null || true
	find . -name '.svelte-kit' -not -path '*/node_modules/*' -exec rm -rf {} + 2>/dev/null || true
	find . -name '.turbo' -exec rm -rf {} + 2>/dev/null || true
	find . -name 'coverage' -not -path '*/node_modules/*' -exec rm -rf {} + 2>/dev/null || true

# Add a new @sveltesentio/* package stub
add-package:
	@read -p "Package name (e.g. payments): " name; \
	mkdir -p packages/$$name/src; \
	echo '{"name":"@sveltesentio/'$$name'","version":"0.0.1","type":"module","private":false,"sideEffects":false,"exports":{".":{".":"./src/index.ts"}}}' > packages/$$name/package.json; \
	echo '{"extends":"../../tsconfig.base.json","compilerOptions":{"rootDir":"src","outDir":"dist"}}' > packages/$$name/tsconfig.json; \
	echo "// @sveltesentio/$$name — not yet implemented" > packages/$$name/src/index.ts; \
	echo "# @sveltesentio/$$name" > packages/$$name/README.md; \
	echo "Created packages/$$name"

# cordanaLLM/praetor Governance Targets
.PHONY: verify-all compile-context audit hiss-coverage

verify-all:
	@pnpm run ci
	@pnpm check:cycles
	@pnpm audit --audit-level=high
	@praetorctl audit
	@praetorctl compile-context --verify
	@$(MAKE) --no-print-directory hiss-coverage

# HISS-20: every enforcement claim in .config/hiss/coverage.yaml is replayed
# against its fixture corpus, so a declared state cannot drift from what the
# tools actually do -- in either direction.
hiss-coverage:
	@praetorctl hiss coverage --verify

compile-context:
	@praetorctl compile-context

audit:
	@praetorctl audit
