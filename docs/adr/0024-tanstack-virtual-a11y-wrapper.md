# ADR-0024: `@tanstack/svelte-virtual@^3` with ARIA-wired wrapper inside `@sveltesentio/ui/data`

- **Status**: Proposed
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D25 in `.workingdir/research/decisions-needed.md`

## Context

Virtualisation is already locked into `@sveltesentio/ui/data` (ADR-0011). Choice of engine: arca uses `@tanstack/svelte-virtual`; `svelte-virtual` (competing package) is stale and missing Svelte 5 runes support. TanStack's engine is framework-native for the Query/Table ecosystem already locked. What's missing is WCAG 2.2 AA scaffolding — raw virtual lists ship no `role`/`aria-rowcount`/`aria-rowindex`, which fails screen-reader navigation of tabular data.

## Decision

Pin `@tanstack/svelte-virtual@^3` inside `@sveltesentio/ui/data`. Ship a runes-native wrapper that auto-wires:

- `role="grid"` on the scroll container
- `aria-rowcount` = total row count (not just rendered count)
- `aria-rowindex` on each row (1-based, stable across scroll)
- `aria-colcount` + `aria-colindex` when used inside a TanStack Table
- Keyboard roving tabindex (Home/End/PgUp/PgDn/Arrow) via a focus registry

## Alternatives considered

- **`svelte-virtual`** — stale + no Svelte 5 runes support.
- **Raw `@tanstack/svelte-virtual`** — ships no ARIA; every consumer re-implements the same scaffolding.
- **IntersectionObserver-based custom** — re-inventing an already-solved engine; TanStack's measurement + overscan logic is hard to beat.

## Consequences

**Positive**:
- Any `ui/data` consumer gets WCAG-AA row semantics for free.
- Folds the ARIA concern at the one place virtualisation exists — no per-app re-implementation.
- Keyboard navigation parity with native tables.

**Negative / trade-offs**:
- Wrapper must stay in sync with TanStack's API (`useVirtualizer` shape).
- ARIA defaults may need overrides for non-grid uses (infinite feed, chat). Wrapper exposes `role` prop to opt out.

**Documentation obligations**:
- `docs/compose/virtual-lists.md` — grid vs list roles, when to override.
- `@sveltesentio/ui/data` AGENTS.md — virtualisation recipe, ARIA contract.
- `axe-core` lane in `@sveltesentio/testing` covers `ui/data` stories.

## Evidence

- `.workingdir/research/ecosystem-pass-1-summary.md:55` — D25 pick.
- `.workingdir/research/deepread-arca.md` — arca's `@tanstack/svelte-virtual` usage.
- ADR-0011 — `ui/data` wrapper scope already locks virtualisation as a wrapped concern.
