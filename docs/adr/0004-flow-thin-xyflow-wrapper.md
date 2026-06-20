# ADR-0004: Thin `@sveltesentio/flow` wrapping `@xyflow/svelte` + elkjs-layout helper + palette

- **Status**: Accepted
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D173 in `.workingdir/research/decisions-needed.md`

## Context

subdo is the only downstream app with a flow/graph editor but composes `@xyflow/svelte` + `elkjs` + category theming + node palette + Yjs collab + full-snapshot undo across ~10 reusable patterns. A bare `docs/compose/` recipe cannot enforce a11y defaults across nodes/edges, edge styles matching `@sveltesentio/ui` tokens, or the elkjs Sugiyama wiring. App-specific canvas logic (smart handle routing, collision-aware drop) is genuinely local and should stay out.

## Decision

Ship `@sveltesentio/flow` as a **thin** wrapper that provides: a11y-defaulted node/edge primitives, edge styles bound to `@sveltesentio/ui` tokens, an elkjs-layout helper (Sugiyama layered + ORTHOGONAL routing default), a category-themed palette component, and a Yjs sync adapter. Exclude subdo's `SmartHandleRouting` + collision-aware AABB drop (app-specific).

## Alternatives considered

- **Downgrade to `docs/compose/flow.md`** — loses a11y enforcement across nodes + elkjs wiring repetition + token coupling; subdo already composes ~10 patterns, framework-level enforcement justified.
- **Heavy wrapper (include smart-handle-routing + collision drop)** — those are subdo-specific interactions; forcing them on other future consumers is premature abstraction.
- **`svelvet`** — subdo is on xyflow; no convergence evidence for svelvet.
- **Custom canvas lib** — reinvents xyflow for no benefit.

## Consequences

**Positive**:

- subdo upgrade path is an import rewrite, not a rebuild.
- elkjs wiring + category theming shipped once; future flow apps inherit the defaults.
- A11y defaults (focusable nodes, ARIA on edges) enforced at framework boundary.

**Negative / trade-offs**:

- Single-adopter evidence (subdo only) — watch for over-fitting to subdo's node model.
- Pinned matrix of `@xyflow/svelte` × `elkjs` × `yjs` to maintain.

**Documentation obligations**:

- `docs/compose/flow-advanced.md` — smart-handle-routing + collision-drop recipes for apps that need them (outside the wrapper).
- `@sveltesentio/flow` AGENTS.md — pinned matrix + a11y contract.

## Evidence

- `.workingdir/research/deepread-subdo.md:11-13,44-107` — 10 named patterns (Yjs sync, elkjs layout, palette, history, categories, realtime highlighting) composed in subdo.
- `.workingdir/research/deepread-subdo.md:132-137` — idiosyncrasies list: custom category theming, smart handle routing, collision-aware drop, snapshot undo, drag-drop palette, JSON-Schema→form.
- `.workingdir/research/deepread-subdo.md:153` — D173 evidence row: "subdo proves enough cross-cutting composition to justify a thin `@sveltesentio/flow` surface".
- `.workingdir/research/decisions-needed.md:253` — streamlining verdict: "Keep thin wrapper (subdo evidence). Exclude canvas logic that is truly app-specific".
- `.workingdir/research/decisions-needed.md:285` — user closure: "Ships: a11y-defaulted nodes, edge styles matching `ui` preset, elkjs-layout helper, palette component, Yjs sync adapter. Excludes subdo's smart-handle-routing + collision-aware drop".
