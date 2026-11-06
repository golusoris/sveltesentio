# CI gates

Continuous integration architecture, gates, schedules, and release attestations.

## PR verification gates

Every PR must pass:

- **Conventional Commits**: PR title checked via `commitlint` in `ci.yml`.
- **ESLint flat config**: 0 errors across TypeScript, Svelte, and accessibility rules.
- **Prettier**: formatted (checked; not auto-fixed in CI).
- **TypeScript**: 0 errors across workspaces (`turbo typecheck`).
- **Vitest**: green + ≥ 70% coverage (≥ 85% for `auth`, `forms`).
- **Playwright**: end-to-end tests green for `auth`, `media`, and `shell` (`End-to-end` job; affected packages only).
- **axe-core**: clean on every Storybook story (`Stories (axe)` job: each story runs as a Chromium test and fails on a violation, ADR-0056).
- **pnpm audit**: clean (no `>=high` advisories).
- **codeql.yml**: clean security analysis.

## Scheduled and non-PR workflows

- **OpenSSF Scorecard** (`scorecard.yml`): runs on `main` push and weekly schedule. Job `Scorecard threshold` reads published OpenSSF Scorecard result for pushed commit (`scripts/scorecard-threshold.mjs`). Score < 7 fails the job and opens/updates one issue labelled `scorecard`; the next passing run closes it.
- **Peer floors** (`peer-floors.yml`): runs weekly and on PRs changing `packages/*/package.json` (release PR included). Job `Peer floors` pins `svelte`, `@sveltejs/kit`, `vite`, `typescript` to lowest release of declared peer range (`scripts/pin-peer-floors.mjs`), then runs typecheck and test for every package. Lockfile CI tests the upper end of each range; this job verifies the lower end.

## Release PR gates

Release PRs additionally verify:

- **SLSA provenance**: Build Level 2 via `actions/attest-build-provenance` in `release-please.yml`.
- **SBOM**: CycloneDX, workflow artifact only.
- **Open (#280)**: Level 3, cosign, npm provenance, SBOM on release. Tracked as exception `HISS-11` in `.standards.yaml`, expires 2027-01-09.
