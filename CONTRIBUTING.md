# Contributing to sveltesentio

Thanks for considering a contribution. sveltesentio is the SvelteKit analog to
[golusoris/golusoris](https://github.com/golusoris/golusoris) — same discipline,
same governance surface, same quality bar. Read this document before opening a PR.

## Before you start

1. Read [AGENTS.md](AGENTS.md) — hard rules 1–12, directory layout, common tasks.
2. Read [docs/principles.md](docs/principles.md) §2.1–§2.11 — Power of 10 (TS-adapted),
   OWASP ASVS L2, WCAG 2.2 AA, Svelte 5 runes-first, supply chain, interface-type UX,
   tooling, testing, performance, no-guessing, strict SvelteKit universe.
3. Read [docs/ux-principles.md](docs/ux-principles.md) before writing UI code.
4. Check [.workingdir/PLAN.md](.workingdir/PLAN.md) for the current phase and
   [.workingdir/STATE.md](.workingdir/STATE.md) for in-flight decisions.
5. Read [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Prerequisites

- **Node 24 LTS** (minimum; see ADR-0021).
- **pnpm 9** (managed by `packageManager` in [package.json](package.json)).
- **TypeScript 6** (see ADR-0020).
- **ESM-only** runtime — no CJS (see ADR-0022).

Open the repo in the provided `.devcontainer` for a matching toolchain.

## Setup

```bash
pnpm install
pnpm run -r build
make ci
```

`make ci` runs lint, type-check, unit, build, audit, and size gates. It must
pass locally before you push — the pre-commit hook enforces this.

## Development workflow

Trunk-Based Development. Default branch is `main`. Feature branches are
short-lived and named `feat/<package>-<slug>`, `fix/<package>-<slug>`, or
`chore/<slug>`.

1. **Open a D-row first for major decisions.** New library, new module, new
   public API surface, breaking change — all go through
   [.workingdir/research/decisions-needed.md](.workingdir/research/decisions-needed.md)
   with evidence from (a) an existing golusoris/app-*, (b) a benchmark, or
   (c) an ADR. AI agents never close a D-row; only the maintainer does.
2. **Harvest first.** Before proposing a new dependency, confirm it isn't
   already solved by something in
   [.workingdir/research/awesome-harvest.md](.workingdir/research/awesome-harvest.md)
   or the shadcn-svelte inventory.
3. **Stay in the SvelteKit universe.** No React, Vue, Solid, Angular, or
   Qwik bridges — Svelte 5 + framework-agnostic libraries only.
4. **Streamline before wrapping.** If an upstream library composes cleanly,
   document the composition in `docs/compose/` instead of wrapping it in
   `@sveltesentio/*`.
5. **Write the code.** Follow the rules in [AGENTS.md](AGENTS.md).
6. **Ship green.** Every merge: 0 ESLint errors, 0 type errors, 0 `pnpm audit`
   vulnerabilities, axe-clean component tests, ≥70% coverage (≥85% for
   `auth`/`forms`).

## Commits

**Conventional Commits 1.0** — enforced by commitlint.

Scope is the package name (`core`, `ui`, `query`, …) or `repo` for root changes.

Examples:

```text
feat(core): add testClock injector

fix(ui): preserve safe-area padding on handheld preset

chore(repo): bump pnpm to 9.14.0

docs(adr): close D172 — paraglide-v2 as i18n default

BREAKING CHANGE: drop CJS build from @sveltesentio/core
```

### Migration footer

Any API change — added, renamed, removed, or behavior-changed public export —
MUST include a `Migration:` block in the commit body with before/after Svelte
snippets:

```text
feat(query)!: rename useQuery to createQuery

Migration:

Before:
  const q = useQuery({ queryKey: ['x'], queryFn: fetchX });

After:
  const q = createQuery({ queryKey: ['x'], queryFn: fetchX });
```

## Pull requests

- **One logical change per PR.** No drive-by refactors.
- **Title mirrors the commit subject** — Conventional Commits format, ≤70 chars.
- **Body covers**: what changed, why (link the ADR or D-row), how it was
  tested, a11y check, any migration notes.
- **Size budget**: aim for <500 LOC changed. If you need more, split the PR.
- **CI must be green** before requesting review.
- **Update docs in the same PR**:
  - `CHANGELOG.md` — only if release-please cannot infer the entry.
  - `.workingdir/STATE.md` session log.
  - `AGENTS.md` layout tree when adding a package.
  - Per-package `AGENTS.md` when adding a module.
  - `README.md` when completing a phase.

## New dependency checklist

Before adding a runtime dependency:

- [ ] Evidence it beats the alternatives (awesome-harvest entry + D-row with
      at least 2 alternatives considered).
- [ ] Actively maintained (commit within 90 days, or justify).
- [ ] License compatible with MIT (MIT / Apache-2.0 / ISC / BSD-2 / BSD-3).
- [ ] ESM-only or ships dual ESM + types.
- [ ] No React / Vue / Solid / Angular / Qwik peer dependency.
- [ ] Bundle size measured and within the package budget.
- [ ] Supply-chain signals checked: download count, publisher, provenance,
      Sigstore/npm attestations, Scorecard score.

Dev dependencies have a lighter bar but still require the license check and
an ESLint/TypeScript/Prettier/Vite plugin ecosystem fit.

## Testing

- **Vitest** — unit tests live in `packages/<name>/test/*.test.ts`.
- **Playwright** — e2e tests live in `apps/<name>/e2e/`.
- **Testing Library + Vitest browser mode** — component tests live in
  `packages/<name>/test/*.svelte.test.ts`.
- **axe-core** — every interactive component ships with an a11y test.

Coverage floors: 70% overall, 85% for `@sveltesentio/auth` and
`@sveltesentio/forms`. Enforced in CI via `pnpm run test:coverage`.

## Accessibility

- Keyboard navigation for every interactive control.
- ARIA attributes validated via `eslint-plugin-svelte` a11y rules.
- axe-core-clean on every component.
- Screen-reader smoke on non-trivial flows (document which reader + version
  you tested with in the PR body).
- Respect `prefers-reduced-motion`, `prefers-color-scheme`,
  `prefers-contrast`.

## Security

- Never log secrets. Never commit secrets — `.env*` is gitignored; use a
  vault or `.env.local`.
- Validate every API boundary input with Zod (see ADR-0001).
- DOMPurify at every `innerHTML` boundary (see `@sveltesentio/ui/markdown`).
- CSP headers + SRI on CDN assets (see `docs/compliance/owasp-asvs-l2.md`).
- Report vulnerabilities privately — see [SECURITY.md](SECURITY.md).

## Releases

Releases are cut by [release-please](https://github.com/googleapis/release-please)
from the `main` branch. Your Conventional Commits drive the version bump:

- `fix:` → patch
- `feat:` → minor
- `feat!:` / `BREAKING CHANGE:` → major (pre-1.0: minor)

Per-package SemVer. Pre-1.0 breaking changes are allowed but still go through
the same migration-footer discipline.

Every release ships: SBOM (Syft), SLSA L3 provenance, keyless cosign signing
via Sigstore, and a `pnpm audit`-clean dependency tree.

## Getting help

- Architecture / design questions → open a Discussion.
- Bug reports → open an Issue with repro steps.
- Security issues → see [SECURITY.md](SECURITY.md) (do not open a public issue).
- General chat → no synchronous channel yet; Discussions is canonical.

Thanks for helping keep the bar high.
