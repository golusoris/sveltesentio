# ADR-0010: `@xyflow/svelte` (SvelteFlow) for flow canvas

- **Status**: Accepted
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D90 in `.workingdir/research/decisions-needed.md`

## Context

subdo is the only flow-graph app in scope and uses `@xyflow/svelte@1.5.2` (the maintained Svelte port of xyflow / React Flow) for its Provider, Controls, Background, MiniMap, Handle, and edge rendering. The user pinned xyflow on day one. Alternatives (svelvet, custom canvas) have no adopter signal and don't match the React Flow parity xyflow provides.

## Decision

Pin `@xyflow/svelte@^1.5` as the flow-canvas engine under `@sveltesentio/flow` (see ADR-0004 for the wrapper policy). Track upstream xyflow's Svelte port as the canonical API surface.

## Alternatives considered

- **`svelvet`** — no subdo adopter; lags xyflow's feature depth.
- **Custom canvas** — reinvents gesture + handle + edge + MiniMap + Controls.
- **React Flow wrapped in a Svelte shim** — unnecessary cross-framework seam.

## Consequences

**Positive**:

- Matches subdo day one.
- Upstream xyflow is actively maintained with a shared core across React + Svelte ports.
- Built-in Provider/Controls/Background/MiniMap/Handle cover subdo's feature list.

**Negative / trade-offs**:

- xyflow's Svelte port can lag the React port on new features.
- Bundle overhead for apps that only need static graphs — mitigated by `@sveltesentio/flow` thin wrapper staying opt-in.

**Documentation obligations**:

- `@sveltesentio/flow` AGENTS.md — xyflow pin matrix + upgrade policy.
- `docs/compose/flow-basics.md` — Provider/Controls/Background/MiniMap defaults.

## Evidence

- `.workingdir/research/deepread-subdo.md:11,150` — `@xyflow/svelte@1.5.2` wired at `flows/[id]/+page.svelte:162-173`; "Stable, no custom edge rendering".
- `.workingdir/research/decisions-needed.md:224` — convergence row: "@xyflow/svelte (SvelteFlow)" (subdo 1/4).
- `.workingdir/research/decisions-needed.md:298` — user closure: "User-pinned from day one".
