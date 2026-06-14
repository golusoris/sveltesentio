# ADR-0054: `elkjs` as the auto-layout engine for `@sveltesentio/flow`

- **Status**: Accepted
- **Date**: 2026-04-18
- **Deciders**: @lusoris (user)
- **D-row**: D92 in `.workingdir/research/decisions-needed.md`

## Context

`@sveltesentio/flow` (thin wrapper around `@xyflow/svelte`, per [ADR-0004](0004-flow-thin-xyflow-wrapper.md)) needs an auto-layout helper. DAG-shaped diagrams (subdo's flow graph, pipeline visualisations, deployment topologies) become unreadable once the user has dragged nodes past ~15 items; a layout command that reflows the graph into a canonical arrangement is a first-class feature, not an optional extra.

Three candidate engines were on the table:

- **`elkjs`** — JavaScript port of the Eclipse Layout Kernel. Sugiyama-style layered layout + orthogonal routing + hierarchical nesting + port constraints. WebAssembly build available.
- **`dagre`** — pure-JS Sugiyama implementation. Historically dominant in the React-flow ecosystem but unmaintained (last release 2020) and DOM-centric in parts.
- **Force-directed (`d3-force`).** Good for organic graphs; poor for DAGs where reading order is part of the meaning.

xyflow's own examples and Svelte Flow docs use `elkjs` for non-trivial layouts; no other engine is recommended by the upstream project.

## Decision

Pin `elkjs` (latest stable) as the auto-layout engine. Expose it from `@sveltesentio/flow` as a layered helper:

1. **`createElkLayout(options)`** — returns a layout function that takes `{ nodes, edges }` and returns re-positioned `{ nodes, edges }`. Defaults: Sugiyama layered algorithm, orthogonal edge routing, top-to-bottom direction, 80 px node-to-node spacing.
2. **Worker execution** — layout runs inside a Web Worker by default. The main thread stays free; Svelte Flow re-renders once on completion.
3. **Preset overrides** — `layered` (default), `force` (stress majorisation), `mrtree` (for tree-shaped graphs). Consumers pick per-graph.
4. **Bundle budget** — elkjs is ~1.5 MB minified; the wrapper imports it dynamically via `import('elkjs/lib/elk.bundled.js')` so the main bundle stays unaffected until the first `createElkLayout()` call.

Accepting this ADR does **not** include a formal bundle-size measurement; that's an acceptance criterion on the Phase 9 scaffold work (see [issue #22](https://github.com/golusoris/sveltesentio/issues/22)). If the measurement reveals an unacceptable size impact for handheld or 10-foot presets, the wrapper can fall back to a lighter tree-only helper — but `elkjs` stays the default for desktop / dashboard presets regardless.

## Alternatives considered

- **`dagre`.** Rejected — unmaintained since 2020 (npm `dagre@0.8.5` latest, no 1.x), smaller scope (no orthogonal routing, no hierarchical nesting, no port constraints), and the xyflow maintainers recommend elkjs in their upstream docs. Pulling dagre in 2026 means adopting a dead dependency and reimplementing features elkjs ships.
- **Force-directed layouts via `d3-force`.** Rejected for the default — force layouts destroy the reading order that makes DAGs legible. Still available as an `elkjs` preset (`stress majorisation`) for graphs where that's desired.
- **Roll our own Sugiyama implementation.** Rejected — layered graph layout is a solved problem with decades of research (ELK dates to 2009). Reimplementing would cost weeks of work to reach parity, and the bundle-size saving would be marginal after gzip.
- **No auto-layout (manual only).** Rejected — downstream subdo already demonstrates the UX breaks past ~15 nodes. Auto-layout is table stakes for any flow UI that graduates beyond toys.

## Consequences

**Positive**:
- Matches upstream xyflow recommendation; integration examples and community patterns are directly applicable.
- Worker-based execution keeps layout off the main thread; no jank on large graphs.
- Dynamic import keeps the main-bundle cost at zero until a consumer actually calls `createElkLayout()`.
- Preset knobs (layered / force / mrtree) cover the cases downstream apps need without requiring per-app layout code.

**Negative / trade-offs**:
- `elkjs` adds ~1.5 MB minified (≈ 400 KB after gzip) to any page that triggers a layout call. Pages that never call it pay zero, but pages that do pay the full cost once. Phase 9 scaffold work must measure the hit on handheld / 10-foot presets and document the budget.
- Worker overhead (postMessage serialisation of the graph) is noticeable on very small graphs (<10 nodes); the wrapper falls back to synchronous execution below that threshold to avoid the overhead.
- Sugiyama layouts are deterministic but not stable across edits — adding one node can cause large reflow. Consumers that need stability between edits should call `createElkLayout()` only on explicit "Arrange" user actions, not on every graph mutation. Documented in the compose recipe.

**Documentation obligations**:
- `packages/flow/AGENTS.md` — document `createElkLayout()` signature + worker fallback threshold + dynamic-import loader.
- [docs/compose/flow-basics.md](../compose/flow-basics.md) — recipe for the explicit "Arrange" button pattern, plus preset selection guide.
- Phase 9 acceptance criterion: bundle-size measurement on the three interface-type presets; results recorded in the Phase 9 issue ([#22](https://github.com/golusoris/sveltesentio/issues/22)).

## Evidence

- [.workingdir/research/decisions-needed.md](../../.workingdir/research/decisions-needed.md) D92 — original decision request; noted `elkjs` as the pinning candidate.
- [.workingdir/research/decisions-still-open.md](../../.workingdir/research/decisions-still-open.md) — D92 listed as "user verbal approval 2026-04-17, no ADR"; this record closes it.
- xyflow Svelte Flow docs — https://svelteflow.dev — recommend `elkjs` in the auto-layout examples.
- ELK project home — https://eclipse.dev/elk/ — algorithm family reference (layered / force / mrtree).
- `elkjs` npm page — https://www.npmjs.com/package/elkjs — bundle entry point `elkjs/lib/elk.bundled.js`; Web Worker recommended by the project's own README.
- [ADR-0004](0004-flow-thin-xyflow-wrapper.md) — parent wrapper decision that this ADR supplements.
