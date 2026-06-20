# ADR-0013: LayerChart v2-next via shadcn Chart + uPlot `docs/compose` escape hatch + `@sveltesentio/ui/chart` a11y wrapper

- **Status**: Accepted
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D120 in `.workingdir/research/decisions-needed.md`

## Context

arca (`StatsChart`) and Lurkarr (`chart-container.svelte:1-81` at `^2.0.0-next.43`) both ship LayerChart. Full re-audit (`reaudit-d120-charts.md`) against shadcn-svelte inventory + live upstream docs shows: shadcn-svelte's `Chart` wraps `layerchart@next` (v2) with oklch CSS variables that match sveltesentio's `@theme` pipeline exactly; LayerChart v2-next is runes-native (`^5.0.0` peer, uses `runed`); @unovis/svelte peers `svelte ^3.48 || ^4` (**no Svelte 5**, disqualified); svelte-echarts imposes a 4–6× bundle penalty and its ECharts a11y primitives are not exposed by the wrapper; uPlot is the clear winner for >5k-point / high-Hz streaming but is canvas-only and Svelte-4-wrapper-only; all three candidates have weak wrapper-level a11y — mitigated by our own wrapper layer.

## Decision

Adopt **LayerChart v2-next** as the chart default, installed via `pnpm dlx shadcn-svelte@latest add chart` (installs `layerchart@next`). Ship `@sveltesentio/ui/chart` as a thin a11y wrapper that injects:

1. `role="img"` + `aria-labelledby` on the chart root.
2. Required `title` prop → `<title>` in SVG; optional `description` → `<desc>`.
3. Off-screen `<table>` sibling with the dataset (SR fallback).
4. `prefers-reduced-motion` respect on any D3 transitions.
5. `<figure>` / `<figcaption>` convention.

Keep **uPlot** as a `docs/compose/charts-realtime.md` escape hatch for observability panels exceeding ~5k points or ≥30 Hz streaming — a thin runes-native action, not a wrapped package. Hold **svelte-echarts** as `docs/compose/charts-exotic.md` for candlestick/gauge/3D only (upgrade to locked dep only if a future app surfaces a concrete need).

## Alternatives considered

- **@unovis/svelte** — peer deps `^3.48 || ^4`, **no Svelte 5** support. Disqualified by locked stack.
- **svelte-echarts** — 4–6× bundle penalty; ECharts a11y primitives (`aria.enabled`, `aria.decal`) not surfaced by wrapper; no oklch/`@theme` binding. Overkill.
- **svelte-chartjs** — no stack advantage over LayerChart; loses composability.
- **Observable Plot direct** — no Svelte binding; off-stack for composed dashboards.
- **uPlot as default** — canvas-only (no SVG print / vector export); loses radial/hierarchy/geo/sankey; `uplot-svelte` wrapper is Svelte-4-only.
- **LayerChart v1-stable** — superseded by v2-next (shadcn uses `@next`); v1 still ships `layercake`, v2 is runes-native via `runed`.

## Consequences

**Positive**:

- First-class citizen of locked stack (shadcn wraps it, runes-native peer, oklch `@theme` binding, SVG SSR-safe).
- Covers all 5 sveltesentio paradigms (admin, observability ≤5k, embedded, mobile, exploration incl. treemap/sankey/force/geo).
- arca + Lurkarr adopt the shadcn Chart wrapper on next pass with minimal rework.
- uPlot escape hatch available for observability panels without adding a second wrapped package.
- `@sveltesentio/ui/chart` a11y layer makes the library choice itself a11y-neutral.

**Negative / trade-offs**:

- LayerChart v2-next is pre-release (hyperactive cadence: `next.53 … next.57` in 8 days); pin carefully.
- SVG ≤~5k-point ceiling → uPlot docs/compose is **required**, not optional, for high-frequency dashboards.
- a11y wrapper layer is ours to maintain, not upstream.

**Documentation obligations**:

- `docs/compose/charts.md` — LayerChart + shadcn Chart patterns, oklch token binding.
- `docs/compose/charts-realtime.md` — uPlot canvas escape hatch for >5k pts / ≥30 Hz.
- `docs/compose/charts-exotic.md` — svelte-echarts recipe for candlestick/gauge/3D (held, not locked).
- `@sveltesentio/ui/chart` AGENTS.md — a11y envelope spec (role/aria/title/desc/table fallback/reduced-motion/figure).

## Evidence

- `.workingdir/research/deepread-arca.md:23,81` — `layerchart` in arca deps, `StatsChart` usage; two-app convergence with Lurkarr.
- `.workingdir/research/deepread-lurkarr.md:18,185-189,319` — `layerchart@^2.0.0-next.43`, `chart-container.svelte:1-81` with CSS customization; lock verdict.
- `.workingdir/research/reaudit-d120-charts.md:7-14` — shadcn-svelte `Chart` wraps `layerchart@next`, oklch `var(--color-chart-N)`, Svelte 5 confirmed.
- `.workingdir/research/reaudit-d120-charts.md:27-36` — LayerChart v2-next runes-native (`runed@0.37.1`), release cadence, chart-type coverage.
- `.workingdir/research/reaudit-d120-charts.md:48-55` — @unovis peers exclude Svelte 5 → disqualified.
- `.workingdir/research/reaudit-d120-charts.md:57-63` — uPlot + `uplot-svelte@1.2.4` Svelte-4 peer; canvas-only; observability specialist.
- `.workingdir/research/reaudit-d120-charts.md:115-126` — four-axes deep-check: a11y weak at library layer, mitigated by `@sveltesentio/ui/chart` wrapper.
- `.workingdir/research/reaudit-d120-charts.md:140-149` — a11y wrapper-layer action items (role/aria/title/desc/table/reduced-motion/figure).
- `.workingdir/research/decisions-needed.md:229,308` — convergence + user closure row.
