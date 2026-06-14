# @sveltesentio/flow — AGENTS.md

> Thin wrapper over `@xyflow/svelte` (SvelteFlow) + `elkjs` auto-layout + DAG helpers. Phase 9 per [.workingdir/PLAN.md](../../.workingdir/PLAN.md).

## Landed (v0.0.1)

| Sub-export | Contents |
|---|---|
| `.` | Barrel re-export of everything below |
| `./dag` | `topologicalSort`, `findCycles`, `hasCycle`, `reachableFrom`, `buildAdjacency`, `CycleError`. Types: `DagNodeLike` (`{id}`) and `DagEdgeLike` (`{source, target}`) — structural, match `@xyflow/svelte` Node/Edge shapes without a hard dep |
| `./layout` | `createElkLayout({algorithm?, direction?, nodeSpacing?, layerSpacing?, layoutOptions?}, factory?)` returns `async (nodes, edges) => {nodes, edges, width, height}` — dynamic imports `elkjs/lib/elk.bundled.js` so the main bundle stays unaffected until first call. `ElkFactory` injection for tests. Types: `SizedNode`, `PositionedNode`, `ElkLayoutResult`, `ElkDirection`, `ElkAlgorithm` |

## Follow-through

| Task | Why deferred |
|---|---|
| `<FlowCanvas>` pre-themed `<SvelteFlowProvider>` wrapper | Needs `.svelte` component files — waiting for `svelte-check` wiring monorepo-wide |
| Node palette (`<ProcessNode>`, `<DecisionNode>`, `<DataNode>`) with ARIA | Same — `.svelte` files + preset-aware sizing tied to #32 ui finishing |
| Worker execution for elkjs (`createLayoutWorker()`) | Needs a shared web-worker harness + SSR/no-worker fallback contract; revisit after first downstream app hits the main-thread jank threshold |
| Bundle-size measurement per interface-type preset | Blocked on #32 preset registry + rollup-plugin-visualizer wiring (ADR-0054 acceptance criterion) |
| Flow compose recipes (`docs/compose/flow-basics.md`, `docs/compose/flow-advanced.md`) | Pending the `<FlowCanvas>` landing above |

## Scope

This package:

- Ships pure DAG helpers typed structurally so consumers can call them over `@xyflow/svelte` Node/Edge arrays (or any `{id}` / `{source, target}` shape) without an import dance.
- Wraps `elkjs` with a factory that picks preset layout options (`layered` default, `force`/`stress`/`mrtree` opt-in), merges consumer overrides, and returns a typed result.
- Stays small — does not re-export `@xyflow/svelte` types. Consumers import from `@xyflow/svelte` directly.

This package does **not**:

- Depend on `dagre` — unmaintained since 2020 (ADR-0054).
- Ship a React/Vue Flow bridge — strict SvelteKit universe rule.
- Own the graph editor UX itself — the `@xyflow/svelte` canvas + node components live in consumer apps for v0.0.1.

## Invariants

- **`@xyflow/svelte` only.** `svelte-flow` (pre-rename) and hand-rolled node editors are rejected.
- **Dynamic elkjs import.** The bundled JS (~1.5 MB min / ~400 KB gzip) is loaded on first `createElkLayout()` call, not at module import time. Pages that never layout pay zero.
- **Deterministic topological sort.** Tie-breaks by id-string sort (stable across runs, stable across machines).
- **Cycle handling is explicit.** `topologicalSort` throws `CycleError` with the first discovered cycle path; callers decide whether to surface it or fall back to `findCycles()` for error-surfacing.
- **Accessibility (planned for `<FlowCanvas>` landing)**:
  - Nodes keyboard-reachable via Tab (`tabindex="0"` default).
  - Arrow keys move focus between connected nodes (via DAG adjacency).
  - Screen-reader label: each node has `aria-label={type}: {name}` + `aria-describedby` linking to the node's description.
  - Canvas has `role="application"` (opt-out when read-only → `role="img"` with off-screen `<table>` alternative).
  - Pan/zoom animations respect `prefers-reduced-motion: reduce`.

## Rejected alternatives

All rejected in [ADR-0004](../../docs/adr/0004-flow-thin-xyflow-wrapper.md) + [ADR-0054](../../docs/adr/0054-elkjs-auto-layout.md):

- **Hand-rolled SVG** — would re-implement pan/zoom, viewport culling, edge routing, node dragging. 3k-LOC problem.
- **React Flow wrapped in Svelte** — cross-framework bridge banned.
- **`dagre`** — unmaintained since 2020; missing orthogonal routing, hierarchical nesting, port constraints.
- **`d3-force` as default** — destroys DAG reading order; available as `force`/`stress` preset instead.
- **Roll our own Sugiyama layout** — solved problem; decades of ELK research.

## Test policy

- DAG helpers: unit-tested against pathological graphs (disconnected, cyclic, self-loop, dangling endpoints). Coverage ≥ 85%.
- elkjs layout: unit-tested with an injected `ElkFactory` double (no real `elkjs` at test time to keep tests deterministic + fast).
- Canvas rendering + visual regression: deferred to the `<FlowCanvas>` landing.
- Coverage ≥ 85% on pure helpers.

## Common tasks

| Task | Command |
|---|---|
| Typecheck | `pnpm --filter @sveltesentio/flow typecheck` |
| Unit tests | `pnpm --filter @sveltesentio/flow test` |

## Related ADRs

- [ADR-0004](../../docs/adr/0004-flow-thin-xyflow-wrapper.md) — thin wrapper decision.
- [ADR-0010](../../docs/adr/0010-xyflow-svelte-flow-canvas.md) — `@xyflow/svelte` for flow canvas.
- [ADR-0054](../../docs/adr/0054-elkjs-auto-layout.md) — `elkjs` auto-layout engine.
