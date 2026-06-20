# ADR-0031: `@axe-core/playwright` + `vitest-axe` as the a11y testing lane inside `@sveltesentio/testing`

- **Status**: Accepted
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D164 in `.workingdir/research/decisions-needed.md`

## Context

WCAG 2.2 AA is a hard rule (CLAUDE.md §2.3, AGENTS.md). Shipping "axe-clean" status requires automation at both levels: unit/component tests (fast feedback) and end-to-end tests (real browser + real focus/contrast). A single lane at one level misses either coverage or speed.

Token-level contrast is separately measurable (oklch + chroma-js / `wcag-contrast` math) without axe — useful as a pre-commit gate on the theme palette.

## Decision

Ship `@sveltesentio/testing` with both lanes preconfigured:

- **`vitest-axe`** — component-level a11y assertions inside Vitest. Runs against each `ui/*` component story via Testing Library.
- **`@axe-core/playwright`** — page-level scans inside Playwright e2e fixtures. Runs against every route in the `kitchen-sink` example app + consumer apps via a shared fixture.
- **Token-pair contrast test** — deterministic Vitest suite reads the `oklch` palette, computes WCAG contrast for every documented token pair (fg-on-bg, border-on-surface, focus ring on any bg). Fails CI on a regression.

stylelint with `a11y/contrast` plugin: evaluated, **not** adopted — duplicates the token-pair test with weaker colour-space support.

## Alternatives considered

- **Playwright-only** — slow feedback on component dev; drives devs to skip a11y tests locally.
- **Vitest-only** — misses focus rings, keyboard order, live-region announcements that only real browsers surface.
- **Pa11y** — less maintained than axe; weaker rule set for 2.2 criteria.

## Consequences

**Positive**:

- `0 axe violations` gate is enforceable at two levels.
- Token-pair test fails loudly on palette drift (oklch-only palette still needs explicit contrast verification).
- Consumers inherit the same fixtures via `@sveltesentio/testing/axe` + `@sveltesentio/testing/playwright-axe`.

**Negative / trade-offs**:

- CI time grows by the axe scan + token test; measured at <30s on the shortlist.
- axe's rule set occasionally diverges from WCAG interpretation; we pin an axe version in `@sveltesentio/testing` and bump via ADR amendment.

**Documentation obligations**:

- `docs/compliance/wcag-checklist.md` — per-criterion coverage (automated vs manual).
- `@sveltesentio/testing` AGENTS.md — fixture surfaces + how to extend.
- Playwright fixture example in `docs/compose/e2e-axe.md`.

## Evidence

- `.workingdir/research/ecosystem-pass-1-summary.md:70` — D164 pick.
- CLAUDE.md §2.3 — WCAG 2.2 AA hard rule.
- `.workingdir/research/ecosystem-batch-b.md` — axe vs pa11y evaluation.
