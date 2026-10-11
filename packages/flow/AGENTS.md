# @sveltesentio/flow — AGENTS.md

> Thin wrapper over `@xyflow/svelte` (SvelteFlow) + `elkjs` auto-layout + DAG helpers. Phase 9 per `.workingdir/PLAN.md`.

## Landed (v0.0.1)

| Sub-export | Contents                                                                                                                                                                                                                                                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.`        | Barrel re-export of everything below                                                                                                                                                                                                                                                                                                                                                  |
| `./dag`    | `topologicalSort`, `findCycles`, `hasCycle`, `reachableFrom`, `buildAdjacency`, `CycleError`. Types: `DagNodeLike` (`{id}`) and `DagEdgeLike` (`{source, target}`) — structural, match `@xyflow/svelte` Node/Edge shapes without hard dep                                                                                                                                             |
| `./layout` | `createElkLayout({algorithm?, direction?, nodeSpacing?, layerSpacing?, layoutOptions?}, factory?)` returns `async (nodes, edges) => {nodes, edges, width, height}` — dynamic imports `elkjs/lib/elk.bundled.js` -> main bundle unaffected until first call. `ElkFactory` injection for tests. Types: `SizedNode`, `PositionedNode`, `ElkLayoutResult`, `ElkDirection`, `ElkAlgorithm` |

## Landed (v0.4.0)

| Sub-export        | Contents                                                                                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `./canvas`        | `<FlowCanvas>` pre-themed `<SvelteFlowProvider>` wrapper (`FlowCanvas.svelte`) plus pure `canvas-model` re-export for unit-testing layout/keyboard wiring |
| `./nodes`         | Node palette components `<ProcessNode>`, `<DecisionNode>`, `<DataNode>` with ARIA, plus `exampleNodeTypes`                                                |
| `./node-palette`  | `NodePalette`, `createNodePalette()`, `createCounterIdFactory()` + node/type-def models                                                                   |
| `./layout-worker` | `createLayoutWorker()` web-worker layout handle + `layoutWorkerHandler()`, with SSR/no-worker fallback contract                                           |

Flow compose recipes (`docs/compose/flow-basics.md`, `docs/compose/flow-advanced.md`) landed.

## Follow-through

| Task                                              | Why deferred                                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Bundle-size measurement per interface-type preset | Blocked on #32 preset registry + rollup-plugin-visualizer wiring (ADR-0054 acceptance criterion) |

## Scope

This package:

- Ships pure DAG helpers typed structurally: consumers call over `@xyflow/svelte` Node/Edge arrays (or `{id}` / `{source, target}` shape) without import dance.
- Wraps `elkjs` with factory picking preset layout options (`layered` default, `force`/`stress`/`mrtree` opt-in), merges consumer overrides, returns typed result.
- Stays small — does not re-export `@xyflow/svelte` types. Consumers import from `@xyflow/svelte` directly.

This package does **not**:

- Depend on `dagre` — unmaintained since 2020 (ADR-0054).
- Ship React/Vue Flow bridge — strict SvelteKit universe rule.
- Own app-specific graph editor UX — ships pre-themed `<FlowCanvas>` wrapper + example node components (`./canvas`, `./nodes`); domain editor layer lives in consumer apps.

## Invariants

- **`@xyflow/svelte` only.** `svelte-flow` (pre-rename) + hand-rolled node editors rejected.
- **Dynamic elkjs import.** Bundled JS (~1.5 MB min / ~400 KB gzip) loaded on first `createElkLayout()` call, not at module import time. Pages never laying out pay zero.
- **Deterministic topological sort.** Tie-breaks by id-string sort (stable across runs, stable across machines).
- **Cycle handling explicit.** `topologicalSort` throws `CycleError` with first discovered cycle path; callers decide whether to surface or fall back to `findCycles()` for error-surfacing.
- **Accessibility**:
  - Nodes keyboard-reachable via Tab (`tabindex="0"` default).
  - Arrow keys move focus between connected nodes (via DAG adjacency).
  - Screen-reader label: each node has `aria-label={type}: {name}` + `aria-describedby` linking to node description.
  - Canvas has `role="application"` (opt-out when read-only -> `role="img"` with off-screen `<table>` alternative).
  - Pan/zoom animations respect `prefers-reduced-motion: reduce`.

## Rejected alternatives

All rejected in [ADR-0004](../../docs/adr/0004-flow-thin-xyflow-wrapper.md) + [ADR-0054](../../docs/adr/0054-elkjs-auto-layout.md):

- **Hand-rolled SVG** — would re-implement pan/zoom, viewport culling, edge routing, node dragging. 3k-LOC problem.
- **React Flow wrapped in Svelte** — cross-framework bridge banned.
- **`dagre`** — unmaintained since 2020; missing orthogonal routing, hierarchical nesting, port constraints.
- **`d3-force` as default** — destroys DAG reading order; available as `force`/`stress` preset instead.
- **Roll own Sugiyama layout** — solved problem; decades of ELK research.

## Test policy

- DAG helpers: unit-tested against pathological graphs (disconnected, cyclic, self-loop, dangling endpoints). Coverage ≥ 85%.
- elkjs layout: unit-tested with injected `ElkFactory` double (no real `elkjs` at test time -> tests deterministic + fast).
- Node components: rendered via `@testing-library/svelte` with `axe-core` a11y assertions (`NodeBody`). Canvas keyboard/layout wiring unit-tested through `canvas-model`.
- Coverage ≥ 85% on pure helpers.

## Common tasks

| Task       | Command                                      |
| ---------- | -------------------------------------------- |
| Typecheck  | `pnpm --filter @sveltesentio/flow typecheck` |
| Unit tests | `pnpm --filter @sveltesentio/flow test`      |

## Related ADRs

- [ADR-0004](../../docs/adr/0004-flow-thin-xyflow-wrapper.md) — thin wrapper decision.
- [ADR-0010](../../docs/adr/0010-xyflow-svelte-flow-canvas.md) — `@xyflow/svelte` for flow canvas.
- [ADR-0054](../../docs/adr/0054-elkjs-auto-layout.md) — `elkjs` auto-layout engine.
