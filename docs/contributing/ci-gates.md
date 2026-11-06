# CI gates

Continuous integration architecture, gates, schedules, and release attestations.

## PR verification gates

PR verification is diff-aware: `scripts/ci-affected.mjs` inspects changed files and selects affected packages. On PRs with no code changes (e.g. docs-only), `lint`, `typecheck`, `test`, `build`, `stories`, `e2e`, and `audit` jobs are skipped, while `CI Gate` (`scripts/ci-gate.mjs`) still runs and accepts the skips for change-scoped jobs when `has_code_changes` is false.

When code changes are present, every affected PR must pass:

- **Conventional Commits**: PR title checked via `commitlint` in `ci.yml`.
- **ESLint flat config**: 0 errors across TypeScript, Svelte, and accessibility rules.
- **Prettier**: formatted (checked; not auto-fixed in CI).
- **TypeScript**: 0 errors across workspaces (`turbo typecheck`).
- **Vitest**: green + coverage thresholds satisfied. Shared default in `vitest.shared.ts` is 85% statements / 80% branches / 85% functions / 85% lines (used by `auth`, `charts`, `collab`, `emulator`, `flow`, `forms`, `i18n`, `ipc-sockmap`, `realtime`, `ui`). Per-package overrides in `packages/*/vitest.config.ts`: 70% flat for `api`, `mcp`, `query`, `testing`, `uploads`; 80% statements/functions/lines and 75% branches for `ai`; 85% statements/branches/lines and 80% functions for `core` and `media`; 85% across all metrics for `shell`.
- **Playwright**: end-to-end tests green for `auth`, `media`, and `shell` (`End-to-end` job; affected packages only).
- **axe-core**: clean on every Storybook story (`Stories (axe)` job: each story runs as a Chromium test and fails on a violation, ADR-0056).
- **pnpm audit**: clean (no `>=high` advisories).
- **codeql.yml**: clean security analysis.

## Scheduled and non-PR workflows

- **OpenSSF Scorecard** (`scorecard.yml`): runs on `main` push and weekly schedule. Job `Scorecard threshold` reads published OpenSSF Scorecard result for pushed commit (`scripts/scorecard-threshold.mjs`). Score < 7 fails the job and opens/updates one issue labelled `scorecard`; the next passing run closes it.
- **Peer floors** (`peer-floors.yml`): runs weekly and on PRs changing `packages/*/package.json` (release PR included). Job `Peer floors` pins `svelte`, `@sveltejs/kit`, `vite`, `typescript` to lowest release of declared peer range (`scripts/pin-peer-floors.mjs`), then runs typecheck and test for every package. Lockfile CI tests the upper end of each range; this job verifies the lower end.

## Release workflow steps

After the release PR merges, the release workflow in `.github/workflows/release-please.yml` runs on push to `main` (and `workflow_dispatch`). It publishes packages to npm and generates:

- **SBOM**: CycloneDX generated before publish via `anchore/sbom-action` (workflow artifact).
- **SLSA provenance**: Build Level 2 via `actions/attest-build-provenance` with subject `packages/*/src/**`.
- **Open (#280)**: Level 3, cosign, npm provenance, SBOM on release. Tracked as exception `HISS-11` in `.standards.yaml`, expires 2027-01-09.
