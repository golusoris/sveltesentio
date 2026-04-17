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
ci:
	pnpm ci

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
