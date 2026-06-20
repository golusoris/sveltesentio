# ADR-0027: Custom focus-graph D-pad router for `ui/preset-10foot`; WICG spatial-nav polyfill deferred

- **Status**: Accepted
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D29 + D141 in `.workingdir/research/decisions-needed.md`

## Context

10-foot (TV) interface presets need D-pad + remote-control focus navigation: arrow keys move between focusable elements in 2-D space, not source order. `svelte-focus-trap` solves modal focus trapping — a different concern. No existing app ships a full spatial-nav layer. The WICG "CSS Spatial Navigation" polyfill exists but has been quiet since 2023; pulling a polyfill that may never ship in browsers risks tech debt.

## Decision

Build `@sveltesentio/ui/preset-10foot` with a custom focus-graph:

- Registry of focusable nodes via `$effect` (nodes self-register on mount, unregister on destroy).
- `tabbable` (transitive via bits-ui) resolves the candidate set; sveltesentio layers 2-D geometry on top (nearest-neighbour by rect centre + angle).
- `embla`'s `slideFocus` option wires carousel navigation into the same graph.
- Arrow keys / D-pad codes route between registered nodes; Enter activates.

Keep `svelte-focus-trap` for modal trapping only (already pinned in `ui/dialog` flow).

Defer the WICG CSS Spatial Navigation polyfill — revisit in v0.3 if the spec advances.

## Alternatives considered

- **`svelte-focus-trap` for everything** — traps focus within a container; doesn't route between siblings on arrow keys.
- **WICG polyfill now** — spec activity has slowed; carrying a polyfill for a spec that may not land is debt.
- **Framework-per-app reimplementation** — every TV-capable app rebuilds the same focus graph.

## Consequences

**Positive**:

- Single focus-graph engine across dashboard / 10-foot / handheld presets.
- No dead polyfill dependency.
- embla carousel navigation integrates naturally via `slideFocus`.

**Negative / trade-offs**:

- Custom focus-graph is ours to maintain; test matrix must cover D-pad + screen-reader at once.
- If CSS Spatial Nav ships, we may want to deprecate the custom graph. Re-audit quarterly.

**Documentation obligations**:

- `docs/compose/10-foot-navigation.md` — focus registration contract, D-pad keymap, embla integration.
- `@sveltesentio/ui/preset-10foot` AGENTS.md — focus-graph API + test harness.
- Playwright scenarios covering arrow-key navigation in a grid + carousel.

## Evidence

- `.workingdir/research/ecosystem-pass-1-summary.md:64` — D29/D141 pick.
- `.workingdir/research/ecosystem-batch-b.md` — WICG polyfill activity check.
- `.workingdir/PLAN.md` — `ui/preset-10foot` in the module catalog.
