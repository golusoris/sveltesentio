# ADR-0053: Repository namespace = `golusoris/sveltesentio`; npm scope = `@sveltesentio/*`

- **Status**: Accepted
- **Date**: 2026-04-18
- **Deciders**: @lusoris (user)
- **D-row**: D1 + D2 in `.workingdir/research/decisions-needed.md`
- **Supersedes / closes**: D1 (org namespace) + D2 (npm scope) — both marked "decision pending" in the research dossier since 2026-04-17.

## Context

Two governance decisions had been deferred during the bootstrap phase:

- **D1** — whether to host the repository at `github.com/lusoris/sveltesentio` (user-scoped personal account) or `github.com/golusoris/sveltesentio` (org-scoped account that also hosts the Go meta-framework `golusoris/golusoris` + the downstream apps `golusoris/app-*`).
- **D2** — whether to publish packages under `@sveltesentio/*` (dedicated scope), `@lusoris/sveltesentio-*` (user-scoped namespace), or `@golusoris/sveltesentio-*` (org-scoped namespace).

Both decisions were effectively made in practice before being recorded. By 2026-04-18 the repo was already hosted at `github.com/golusoris/sveltesentio` (verified via `git remote -v`), and every scaffolded package in `packages/*/package.json` already used the `@sveltesentio/*` scope. This ADR ratifies the existing state.

## Decision

1. **Repository namespace** — `github.com/golusoris/sveltesentio`. This aligns with the downstream apps (`golusoris/app-arca`, `/app-revenge`, `/app-subdo`, `/app-lurkarr`) and the backend meta-framework (`golusoris/golusoris`) under the same org. Transfer of ownership from a personal account is avoided because the repo was initialised in the org from day one.
2. **npm scope** — `@sveltesentio/*`. The scope is dedicated to this framework, not piggy-backed on `@golusoris/*` (which may be used by the Go side's JavaScript tooling in future) or `@lusoris/*` (personal-account scope). A dedicated scope keeps publishing permissions, 2FA policy, and provenance attestation isolated from adjacent projects.
3. **Supply-chain hygiene** — 2FA required on the npm scope; secret scanning + branch protection on the GitHub repo. Tracked separately as [issue #31](https://github.com/golusoris/sveltesentio/issues/31); this ADR locks the namespace choice but not the per-setting configuration.

## Alternatives considered

- **`github.com/lusoris/sveltesentio` (user namespace).** Rejected — all sibling projects live in the `golusoris/` org; a user-scoped meta-framework would create a cross-namespace link graph that makes governance (CODEOWNERS, branch protection, secret scanning) harder to enforce consistently and complicates future co-maintainer onboarding.
- **`@lusoris/sveltesentio-*` or `@golusoris/sveltesentio-*` (piggybacked scopes).** Rejected — shared scopes concentrate risk: a single compromised 2FA token could publish malicious versions across unrelated packages. A dedicated `@sveltesentio/*` scope limits blast radius and matches how `@sveltejs/*`, `@tanstack/*`, `@xyflow/*` are organised upstream.
- **No decision / defer indefinitely.** Rejected — the bootstrap drift (repo already at `golusoris/`, packages already on `@sveltesentio/*`) was already documented in STATE.md as a gap. Ratifying the status quo closes the research loop and prevents future confusion.

## Consequences

**Positive**:
- Aligns framework home with backend (`golusoris/golusoris`) + downstream apps (`golusoris/app-*`) under one org — single CODEOWNERS, single branch-protection policy, single secret-scanning org.
- `@sveltesentio/*` scope is short, memorable, and scannable by supply-chain tooling (e.g. GitHub secret scanning partner program, npm provenance attestation).
- No repo transfer required — state already matches this decision.

**Negative / trade-offs**:
- Contributors submitting PRs need `golusoris/` org membership or fork-and-PR flow. This is standard open-source behaviour; not a regression.
- npm-scope registration requires a dedicated `@sveltesentio` npm org with its own 2FA policy — one-time setup, covered by [issue #31](https://github.com/golusoris/sveltesentio/issues/31).

**Documentation obligations**:
- `.workingdir/PLAN.md` §1 Mission + §7 Org/repo settings updated (done 2026-04-18).
- `.workingdir/STATE.md` packages table + Repo line updated (done 2026-04-18).
- `.workingdir/research/decisions-still-open.md` — D1 + D2 marked closed by this ADR (done via this amendment).
- README.md + per-package `package.json` files already use the final names; no further edits required.

## Evidence

- `git remote -v` on 2026-04-18 confirmed `origin = git@github.com:golusoris/sveltesentio.git`.
- Every scaffolded `packages/*/package.json` already declares `"name": "@sveltesentio/<module>"`.
- [.workingdir/research/decisions-needed.md](../../.workingdir/research/decisions-needed.md) D1 + D2 rows (original decision request).
- [.workingdir/research/drow-adr-map.md](../../.workingdir/research/drow-adr-map.md) — authoritative D-row → ADR mapping (this ADR closes D1 + D2).
- [issue #31](https://github.com/golusoris/sveltesentio/issues/31) — follow-on for 2FA / secret scanning / branch protection configuration.
