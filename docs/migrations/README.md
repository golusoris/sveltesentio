# Migrations

Migration guides for adopting or upgrading `@sveltesentio/*` releases.

## How this directory is organised

- **`downstream-antipatterns-v<MAJOR.MINOR>.md`** — issued *once per release* before the version ships. Lists the patterns existing apps must remediate before pulling that release. Authoritative checklist for downstream maintainers.
- **`v<MAJOR.MINOR>.md`** — issued *with each release* (target version in the filename). Covers the framework-level breaking changes between the previous release and this one, plus the codemods that automate the rewrite where automation is possible.

Both files use the same severity legend: `security` · `correctness` · `maintenance` · `dead`.

## Index

| File | Purpose | Status |
|---|---|---|
| [downstream-antipatterns-v0.1.md](downstream-antipatterns-v0.1.md) | Pre-v0.1 remediation checklist for downstream apps (`golusoris/app-{arca,revenge,subdo,lurkarr}`) | Active — covers v0.1 adoption |
| [v0.2.md](v0.2.md) | Template: framework-level breaking changes + codemods between v0.1.x and v0.2.0 | Template — populate at v0.2.0 release time |

## Conventions

- **Frontmatter** on every per-version file: `from-version`, `to-version`, `release-date`, `breaking-changes` (count), `codemods` (count). Machine-readable so `release-please` and downstream upgrade tooling can index it.
- **Each breaking-change row** cites the dispositive ADR and the migration shape (one-line `pnpm` / grep / codemod instruction; longer recipes live in the ADR).
- **Codemod recipes** ship as either: (a) shell one-liners (grep + sed / `pnpm`), (b) AST transforms via `jscodeshift` or `ast-grep` rules, or (c) inline before/after Svelte snippets. Pick the lightest tool that does the job; AST transforms only when grep-based rewrites would be unsafe.

## Authoring checklist for a new `v<MAJOR.MINOR>.md`

When opening a release-prep PR for `v0.x`:

1. Copy [v0.2.md](v0.2.md) → `vN.md`. Update the frontmatter (`from-version`, `to-version`, `release-date`).
2. For each merged PR with a `Migration:` commit footer between the previous release tag and `HEAD`, add a row.
3. Provide the codemod alongside (`tools/migrations/v<N>/`) when the rewrite is mechanical. Reference the file from this doc.
4. Cross-link the ADR(s) that justify each breaking change.
5. Update the [Index](#index) above.
6. Land the migration doc together with the release-please PR — never lag behind the release.
