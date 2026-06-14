# Monorepo releases — release-please per-package, Conventional Commits,
# SemVer + provenance

sveltesentio ships 12 `@sveltesentio/*` packages from a single pnpm
workspace. Releases are managed by **release-please** (the default per
[principles.md §2.7](../principles.md)) against Conventional-Commit
history. Each package has its own semver track, its own
`CHANGELOG.md`, and its own npm publish pipeline.

This recipe documents the end-to-end flow:

- `release-please-config.json` + `.release-please-manifest.json` shape.
- The **release PR** lifecycle (auto-open → review → merge → publish).
- Conventional Commit scoping rules that drive per-package versioning.
- Why **release-please** over **Changesets** for this monorepo.
- Provenance + SBOM attestation wired into the publish workflow.

## Related

- [ADR-0022](../adr/0022-esm-only.md) — ESM-only package shape.
- [principles.md §2.5](../principles.md) — supply chain invariants
  (SBOM, provenance, `pnpm audit` clean).
- [principles.md §2.7](../principles.md) — Conventional Commits
  + SemVer + release-please.
- [AGENTS.md](../../AGENTS.md) — repo layout referencing the
  release-please workflow.
- [CONTRIBUTING.md](../../CONTRIBUTING.md) — contributor-facing release
  process.

## When to use release-please vs Changesets

Both manage version bumps + changelogs in a monorepo. Decision came out
in favour of release-please on four axes:

```text
Trigger                      release-please         Changesets
---------------------------  ---------------------  ---------------------
Source of truth              Conventional Commits   .changeset/*.md files
Contributor friction         Zero (commit prefix)   Must author .changeset
AI-agent friendliness        High (no extra step)   Medium (extra file)
Monorepo dependency bumps    Auto via plugin        Manual or auto
Provenance attestation       Native npm support     Native npm support
Release cadence              Continuous (per merge) Batch (PR-driven)
Rollback                     Revert commit          Revert + publish
```

release-please wins because sveltesentio's commit flow is AI-agent-heavy
and Conventional Commit prefixes are already enforced by commitlint.
Adding a `.changeset/*.md` file per PR is pure friction that agents
frequently skip. release-please parses what's already there.

The trade-off: Changesets' batch cadence makes coordinated multi-package
releases slightly simpler. release-please handles this via
**component-coordinated** releases (multiple packages in a single
release PR when their histories all have bumps pending) — good enough
for this workspace.

## Config shape

```json
// release-please-config.json
{
  "release-type": "node",
  "bump-minor-pre-major": true,
  "bump-patch-for-minor-pre-major": false,
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
    "packages/ui":   { "package-name": "@sveltesentio/ui" }
  }
}
```

```json
// .release-please-manifest.json
{
  "packages/core": "0.0.1",
  "packages/ui":   "0.0.1"
}
```

Four invariants worth pinning:

1. **`bump-minor-pre-major: true`** — while the workspace is in v0.x,
   a `feat:` commit bumps **minor** (0.1 → 0.2). Breaking changes bump
   minor too. The BREAKING-CHANGE → major rule only applies past v1.0.
2. **`bump-patch-for-minor-pre-major: false`** — a `fix:` commit in v0.x
   bumps **patch** (0.1.0 → 0.1.1), not minor. Keeps patches cheap.
3. **`include-v-in-tag: true`** — tags are `@sveltesentio/core-v0.2.1`,
   matching the GitHub Releases convention.
4. **Hidden sections** (`docs`, `test`, `ci`, `build`, `chore`) — these
   show up in CHANGELOG only if a contributor misclassifies; they're
   hidden to keep user-visible changelogs signal-rich.

## Commit-scope rules — the per-package driver

release-please decides **which** package to bump by looking at the
file paths touched in each commit. A commit touching `packages/ui/src/button/Button.svelte`
bumps `@sveltesentio/ui`. Commits touching multiple packages bump all
of them.

The Conventional Commit **scope** is documentation-only from
release-please's perspective, but we still enforce it:

```text
feat(ui): add Button variant loader
fix(auth): honour refresh-token rotation on 401
perf(core): dedupe zod parse in openapi-fetch wrapper
deps(realtime): bump @connectrpc/connect-web to 2.1.1
```

Scope matches the package subdirectory (`packages/<scope>/`). Breaking
change syntax:

```text
feat(ui)!: rename Button variant prop from `kind` to `variant`

BREAKING CHANGE: `Button.kind` is removed. Migration: rename
`kind="primary"` to `variant="default"` etc.

Migration:
  <Button kind="primary"/>   →  <Button variant="default"/>
  <Button kind="danger"/>    →  <Button variant="destructive"/>
```

The `!` after the type (or `BREAKING CHANGE:` footer) triggers a
**minor** bump in v0.x (via `bump-minor-pre-major`) and a **major**
bump post-v1.0. Always include a `Migration:` footer with before/after
snippets — this is the commit-style rule from [CLAUDE.md](../../CLAUDE.md).

## Release PR lifecycle

```text
Merge to main
   ↓
release-please action runs
   ↓
Opens / updates "chore(main): release" PR
   ↓
PR lists version bumps + CHANGELOG diff per package
   ↓
Human reviews changelog + approves
   ↓
Merge release PR
   ↓
release-please tags + GitHub Release per package
   ↓
release-sveltekit.yml reusable workflow publishes to npm
   ↓
Provenance attestation + SBOM artifact uploaded
```

One release PR is open at a time. Every non-release commit to `main`
updates it. Merging it cuts the release; release-please closes and
re-opens a fresh empty PR for the next cycle.

## `.github/workflows/release-please.yml`

```yaml
name: release-please

on:
  push:
    branches: [main]

permissions:
  contents: write
  pull-requests: write
  id-token: write    # npm provenance

jobs:
  release-please:
    runs-on: ubuntu-latest
    outputs:
      releases_created: ${{ steps.rp.outputs.releases_created }}
      paths_released:   ${{ steps.rp.outputs.paths_released }}
    steps:
      - uses: googleapis/release-please-action@v4
        id: rp
        with:
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json

  publish:
    needs: release-please
    if: needs.release-please.outputs.releases_created == 'true'
    uses: ./.github/workflows/release-sveltekit.yml
    with:
      paths: ${{ needs.release-please.outputs.paths_released }}
    secrets:
      NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

The `id-token: write` permission is **mandatory** for npm provenance
attestation via `npm publish --provenance`. Without it, publish still
succeeds but the package shows "no provenance" on npmjs.com.

## `release-sveltekit.yml` — publish + provenance + SBOM

```yaml
name: release-sveltekit

on:
  workflow_call:
    inputs:
      paths: { required: true, type: string }
    secrets:
      NPM_TOKEN: { required: true }

permissions:
  contents: read
  id-token: write
  attestations: write

jobs:
  publish:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        path: ${{ fromJSON(inputs.paths) }}
      fail-fast: false
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          registry-url: 'https://registry.npmjs.org'
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter "./${{ matrix.path }}" build
      - name: SBOM
        run: |
          pnpm dlx @cyclonedx/cdxgen -o sbom.cdx.json ${{ matrix.path }}
      - uses: actions/attest-sbom@v2
        with:
          subject-path: ${{ matrix.path }}/package.json
          sbom-path: sbom.cdx.json
      - name: Publish
        run: |
          cd ${{ matrix.path }}
          pnpm publish --provenance --access public --no-git-checks
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
      - uses: actions/upload-artifact@v4
        with:
          name: sbom-${{ matrix.path }}
          path: sbom.cdx.json
```

Three supply-chain invariants per [principles.md §2.5](../principles.md):

1. **`npm publish --provenance`** — SLSA provenance attestation
   published to the npm registry, verifiable via `npm audit signatures`
   + `gh attestation verify`.
2. **CycloneDX SBOM** — generated per package, attested via
   `actions/attest-sbom`, uploaded as workflow artifact.
3. **cosign-signable releases** — the GitHub Release already includes
   `checksums.txt`; cosign signing of that file is a separate
   workflow step (see [SECURITY.md](../../SECURITY.md)).

## Local release dry-run

```bash
pnpm dlx release-please release-pr \
  --token=$GITHUB_TOKEN \
  --repo-url=lusoris/sveltesentio \
  --config-file=release-please-config.json \
  --manifest-file=.release-please-manifest.json \
  --dry-run
```

Shows which packages would bump and the CHANGELOG diff. Useful before
merging a contentious PR to confirm no unintended major bump slips in
from a stray `BREAKING CHANGE:` footer.

## Dependency bumps across packages

When `@sveltesentio/ui` bumps, packages depending on it (nothing yet,
but `@sveltesentio/forms` will) need their `package.json` dep range
updated. release-please's `linked-versions` is too blunt (bumps every
listed package to the same version — not what we want here). Instead:

- Package deps use `"^0.1.0"` ranges (semver-compatible).
- release-please does **not** auto-bump downstream ranges on patch.
- On minor bump of an upstream, open a follow-up PR with the range bump
  + integration test:

```text
deps(forms): bump @sveltesentio/ui to ^0.2.0

Tests the new Button variant surface against Superforms field wrappers.
```

The commit type `deps` renders under the Dependencies section of the
downstream package's CHANGELOG.

## Initial release (`0.0.1` → `0.1.0`)

The manifest lists every package at `0.0.1`. The first time each
package has a `feat:` commit, release-please bumps it to `0.1.0`. To
**force** an initial release (e.g. the `@sveltesentio/core` Phase 1
cut even without feat commits), use a bootstrap commit:

```text
chore(core): bootstrap 0.1.0

Release-As: 0.1.0
```

The `Release-As:` footer is a release-please override. Use sparingly
— only for the first release of a new package.

## Pre-release / release-candidates

For `0.1.0-rc.0` style tags, set `prerelease: true` in the package
config:

```json
{
  "packages": {
    "packages/ui": {
      "package-name": "@sveltesentio/ui",
      "prerelease": true,
      "prerelease-type": "rc"
    }
  }
}
```

Ship an RC with:

```text
feat(ui)!: redesign Button surface (experimental)

Release-As: 0.2.0-rc.0
```

Flip `prerelease: false` when the stable cut lands; release-please
graduates `0.2.0-rc.N` → `0.2.0` automatically.

## Rollback

release-please doesn't support "unpublish". Options:

1. **`npm deprecate`** the bad version with a message pointing to the
   fixed version. Required when the bad version introduces a real bug.
2. **Publish a patch fix** with a `fix(<scope>):` commit — release-please
   opens the next release PR immediately on merge.
3. **`git revert` the bad commit** on `main` — release-please tracks
   the revert and the CHANGELOG reflects it.

Never `npm unpublish` unless the version contains a credential leak
or malware. Unpublishing breaks consumers that already installed.

## Commit-lint integration

```js
// commitlint.config.js
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', [
      'feat', 'fix', 'perf', 'revert', 'refactor',
      'deps', 'docs', 'test', 'ci', 'build', 'chore',
    ]],
    'scope-enum': [2, 'always', [
      'core', 'ui', 'query', 'forms', 'i18n',
      'auth', 'realtime', 'flow', 'media', 'charts',
      'ai', 'testing', 'ipc-sockmap', 'shell', 'uploads',
      'collab', 'ci', 'deps', 'repo',
    ]],
    'scope-empty': [2, 'never'],
    'subject-case': [2, 'never', ['sentence-case', 'start-case', 'pascal-case', 'upper-case']],
  },
};
```

CI runs `commitlint` on every commit of every PR. An invalid commit
message blocks merge — this is the source of truth release-please
reads, so the rule strictness is non-negotiable.

## Downstream apps

Downstream consumers (arca, lurkarr, revenge, subdo — see the
[downstream-apps reference](../../.workingdir/STATE.md)) ship their own
release cycles via `ci-sveltekit.yml` (the reusable app workflow).
Their release story is simpler (app, not library):

- App gets its own `release-please-config.json` with a single entry.
- Publishes a GitHub Release + container image; no npm publish.
- Consumes `@sveltesentio/*` at pinned ranges.

## Testing the release pipeline

Full dry-run locally with `act`:

```bash
act push -W .github/workflows/release-please.yml \
  --secret-file .env.act \
  --container-architecture linux/amd64
```

Requires a `.env.act` with a throwaway `GITHUB_TOKEN`. `act` runs the
release-please action against a shallow local clone — no real PRs get
created.

## Anti-patterns

- **Commits without Conventional-Commit prefix.** release-please
  silently ignores them — zero bump even on a real feature. Commitlint
  catches this; don't `--no-verify` bypass.
- **`BREAKING CHANGE:` without `Migration:` footer.** Violates the
  [CLAUDE.md](../../CLAUDE.md) tone rule and leaves consumers stranded.
- **`scope: all` / missing scope.** release-please will attribute to
  every package the commit touches, which is rarely what you want.
  Always scope to one package per commit.
- **Manual version bumps in `package.json`.** release-please overwrites
  them — commit gets reverted in the next release PR. Use
  `Release-As:` footer instead.
- **Disabling `id-token: write`.** Publishes succeed but without
  provenance. Violates [principles.md §2.5](../principles.md).
- **`npm publish` outside the workflow.** No provenance, no SBOM, no
  attestation. Local publish is only valid for the initial
  bootstrap (and even that should go through the workflow).
- **Mixing `feat:` and `fix:` in the same commit.** Release-please
  picks the higher bump. Split into two commits so the changelog is
  accurate.
- **`chore: release 0.2.0` as a commit message.** release-please does
  this automatically; manual release commits confuse the PR tracker.
- **Raising v0.1.0 → v1.0.0 without an ADR.** v1.0 is a stability
  promise to consumers. Requires an ADR + migration doc +
  `BREAKING CHANGE:` footer auditing the full API surface.
- **Switching to Changesets mid-workspace.** The `.changeset/` /
  `release-please-config.json` histories don't merge cleanly. Decide
  once; stick with release-please unless a year of evidence says
  otherwise.
- **Publishing from a feature branch.** Only the release PR (merged to
  `main` by release-please) triggers publish. Branch publishes pollute
  the npm version namespace.

## References

- [ADR-0022](../adr/0022-esm-only.md) — ESM-only package shape.
- [principles.md §2.5](../principles.md) — supply chain.
- [principles.md §2.7](../principles.md) — Conventional Commits,
  SemVer, release-please.
- [SECURITY.md](../../SECURITY.md) — coordinated disclosure + cosign
  verify-blob snippet.
- release-please: <https://github.com/googleapis/release-please>.
- release-please-action: <https://github.com/googleapis/release-please-action>.
- Conventional Commits 1.0: <https://www.conventionalcommits.org/en/v1.0.0/>.
- npm provenance: <https://docs.npmjs.com/generating-provenance-statements>.
- CycloneDX: <https://cyclonedx.org/>.
- SLSA: <https://slsa.dev>.
