# golusoris CI Reference

Fetched 2026-04-17. Source: github.com/golusoris/golusoris/.github/

## Workflow files (9 total)

1. ci.yml — main CI: pr-title + lint (golangci-lint) + gosec + govulncheck + test (-race + coverage 70%) + build + spectral (OpenAPI) + apidiff
2. release.yml — GoReleaser on tag push: SBOM (syft) + cosign signing + SLSA provenance + GHCR OCI image
3. scorecard.yml — OSS Scorecard weekly + on push to main, uploads SARIF
4. codeql.yml — CodeQL Go analysis on push/PR/weekly
5. auto-assign.yml — assign @lusoris on all issues/PRs via github-script
6. ci-go.yml — REUSABLE workflow for downstream Go apps (inputs: go-version, coverage-threshold, timeout)
7. release-go.yml — REUSABLE release workflow for downstream apps (OCI image + SBOM + cosign + SLSA)
8. rebuild-on-base.yml — REUSABLE container rebuild on base image update
9. release-please.yml — release-please-action on push to main

## Key patterns to replicate for sveltesentio

- All action refs pinned by commit SHA (not tag)
- concurrency: cancel-in-progress on same workflow+ref
- permissions: contents: read at top level, escalate per-job as needed
- pr-title job: bash grep regex for Conventional Commits format
- auto-assign: github-script assigns @lusoris on open issues+PRs
- coverage gate: bash awk checks numeric threshold, fails with ::error::
- SARIF uploads for gosec + scorecard + codeql → GitHub Security tab
- release-please-config.json: release-type, changelog-sections, packages map

## release-please-config.json structure

```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "release-type": "node",
  "bump-minor-pre-major": true,
  "include-v-in-tag": true,
  "changelog-path": "CHANGELOG.md",
  "changelog-sections": [
    { "type": "feat", "section": "Features" },
    { "type": "fix", "section": "Bug Fixes" },
    { "type": "perf", "section": "Performance" },
    { "type": "revert", "section": "Reverts" },
    { "type": "refactor", "section": "Code Refactoring" },
    { "type": "deps", "section": "Dependencies" },
    { "type": "docs", "section": "Documentation", "hidden": true },
    { "type": "test", "section": "Tests", "hidden": true },
    { "type": "ci", "section": "CI", "hidden": true },
    { "type": "build", "section": "Build", "hidden": true },
    { "type": "chore", "section": "Chores", "hidden": true }
  ],
  "packages": {
    "packages/core": { "package-name": "@sveltesentio/core" },
    "packages/ui": { "package-name": "@sveltesentio/ui" },
    "packages/query": { "package-name": "@sveltesentio/query" },
    "packages/forms": { "package-name": "@sveltesentio/forms" },
    "packages/i18n": { "package-name": "@sveltesentio/i18n" },
    "packages/auth": { "package-name": "@sveltesentio/auth" },
    "packages/realtime": { "package-name": "@sveltesentio/realtime" },
    "packages/flow": { "package-name": "@sveltesentio/flow" },
    "packages/media": { "package-name": "@sveltesentio/media" },
    "packages/charts": { "package-name": "@sveltesentio/charts" }
  }
}
```

## dependabot.yml structure

- github-actions: weekly Mondays 06:00 UTC, max 10 open PRs, grouped
- npm: weekly Mondays 07:00 UTC, max 15 open PRs, grouped by category
- Groups: sveltesentio-internal, svelte-ecosystem, tanstack, testing, build-tools
