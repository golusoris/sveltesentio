# @sveltesentio/charts — AGENTS.md

> Dashboard chart wrappers with a11y baked in. Phase 11 per [.workingdir/PLAN.md](../../.workingdir/PLAN.md).

## Scope

Thin wrapper over **LayerChart v2-next** (via shadcn-svelte Chart) + **uPlot** escape hatch for high-frequency / >5k-point series. Composes the a11y layer that neither library ships at the wrapper level.

### Landed (v0.2.0)

The a11y envelope + the framework-agnostic, unit-tested core. The wrapper does **not** import LayerChart — the caller renders the visual inside the `chart` snippet, so the package survives LayerChart v2-next's volatile pre-release API.

| Export                                                      | Purpose                                                                                                                                                                                             | ADR                                                                          |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `<ChartFigure>` (`./figure`)                                | `<figure>` / `<figcaption>` + `role="img"` + `aria-labelledby` / `aria-describedby` + visually-hidden `<table>` SR fallback built from `{series, x, y}`; `chart` snippet is the visual escape hatch | [ADR-0013](../../docs/adr/0013-layerchart-charts-with-uplot-escape-hatch.md) |
| `buildDataTableModel()` (`./a11y-table`)                    | Pure builder turning `{series, x, y}` into the SR data-table model; unions sparse x values in first-seen order, `—` placeholder for gaps / nullish; **unit-tested**                                 | [ADR-0013](../../docs/adr/0013-layerchart-charts-with-uplot-escape-hatch.md) |
| `dashboardPreset()` / `prefersReducedMotion()` (`./preset`) | Sensible LayerChart defaults (padding, both grids, x-bisect tooltip, cubic-out tween) with motion collapsed to 0 under reduced-motion; SSR-safe media query read; **unit-tested**                   | [ADR-0013](../../docs/adr/0013-layerchart-charts-with-uplot-escape-hatch.md) |

### Landed (v0.5.0)

The semantic chart components, the low-level `<Chart>` re-export, the uPlot escape hatch, and the oklch palette helpers.

| Export                                                                                                                                 | Purpose                                                                                                                             | ADR                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `<LineChart>` / `<AreaChart>` / `<BarChart>` / `<PieChart>` / `<ScatterChart>` (`./line` / `./area` / `./bar` / `./pie` / `./scatter`) | LayerChart-backed semantic charts with oklch palette                                                                                | [ADR-0013](../../docs/adr/0013-layerchart-charts-with-uplot-escape-hatch.md) |
| `<Chart>` low-level (`./chart`)                                                                                                        | LayerChart primitive re-export for custom compositions                                                                              | —                                                                            |
| `createUPlotChart()` (`./uplot`)                                                                                                       | Escape hatch for >5k-pt or high-Hz feeds (network graphs, observability sparklines), fed by `@sveltesentio/realtime` SSE (ADR-0037) | [docs/compose/charts-realtime.md](../../docs/compose/charts-realtime.md)     |
| `chartPalette` / `chartSeriesColor()` (`./palette`) + series helpers (`./chart-series`)                                                | Semantic oklch palette + `{series, x, y}` mappers shared by the components and `<ChartFigure>`                                      | [ADR-0013](../../docs/adr/0013-layerchart-charts-with-uplot-escape-hatch.md) |

### Planned / follow-through

| Export                                         | Purpose                                                            | ADR                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `@sveltesentio/chart-a11y-wrapper` ESLint rule | Flags bare LayerChart / uPlot render that bypasses `<ChartFigure>` | [ADR-0013](../../docs/adr/0013-layerchart-charts-with-uplot-escape-hatch.md) |

## Why LayerChart v2-next (primary)

- Runes-native.
- Direct match for `@theme` oklch pipeline via shadcn-svelte Chart wrapper.
- `bind:clientWidth` / `bind:clientHeight` compatible with Tailwind 4 container queries.
- Covers all 5 sveltesentio paradigms — admin, observability (≤5k pts), embedded, mobile, exploration (incl. treemap / sankey / force / geo).

## Why uPlot escape hatch

- Canvas-only — no vector print; wrapped in `createUPlotChart()` for the specific case of >5k-point series or high-Hz streaming feeds.
- Manual 44 px oversizing via wrapper — uPlot's native hit-targets fail touch-size WCAG 2.5.8.
- Pan is plugin-only — wrapper bakes it in.

## Rejected alternatives

- **svelte-echarts** — 4–6× bundle, no Tailwind theming, ECharts a11y primitives not exposed at the wrapper level. Held only as `docs/compose/charts-exotic.md` for candlestick / gauge / 3D.
- **@unovis/svelte** — no Svelte 5 support.

## Invariants — a11y

Every chart rendered through this package **must** go through `<ChartFigure>`. Bare LayerChart / uPlot render without it is intended to be an ESLint error (`@sveltesentio/chart-a11y-wrapper`, follow-through). As landed in v0.2.0, `<ChartFigure>` enforces:

- `<figure>` / `<figcaption>` wraps the chart + its accessible name (`title` prop, **required** — no anonymous charts).
- `role="img"` on the visual container `<div>`, library-agnostic (works for LayerChart SVG **or** uPlot canvas).
- `aria-labelledby` → the `<figcaption>` id; `aria-describedby` → the optional `description` `<p>` id when present.
- Visually-hidden `<table>` (clip-rect `sr-only`) renders the dataset as a structured text alternative (WCAG 2.2 SC 1.1.1), generated from the **same** `{series, x, y}` as the visual so the two cannot drift.
- `prefersReducedMotion()` feeds `dashboardPreset({ reducedMotion })`, collapsing tween duration to 0 (SC 2.3.3 / 2.2.2).

## Invariants — data

- **No raw `Date.now()`** in axis formatters. Use the injected clock from `@sveltesentio/core/clock` (ADR-0052) — ensures tests can deterministically snapshot axes.
- **Palette is semantic, not decorative.** `role="chart-series-1"` etc. maps to oklch tokens from `@sveltesentio/ui/tokens`.

## Test policy

- **Landed (v0.2.0):** the pure core is unit-tested in plain Node (no DOM) — `buildDataTableModel` (single / multi / sparse series, nullish + NaN, custom formatters, numeric x keys, empty input, duplicate-x overwrite) and `dashboardPreset` / `prefersReducedMotion` (defaults, reduced-motion collapse, partial-padding merge, no shared-base mutation, SSR-no-`matchMedia` path). `.svelte` is not `tsc`-checked (plain `tsc` skips the extension); `ChartFigure.svelte` is verified to compile clean under the Svelte 5 runes compiler instead, and the testable logic lives in the unit-tested `.ts` modules per repo precedent.
- **Follow-through:** visual regression per paradigm (admin line / observability sparkline / embedded bar / mobile pie / exploration treemap); component a11y tests (axe-core) once the semantic chart components land; uPlot escape-hatch perf trace against 100k-pt series.

## Common tasks

| Task       | Command                                        |
| ---------- | ---------------------------------------------- |
| Typecheck  | `pnpm --filter @sveltesentio/charts typecheck` |
| Unit tests | `pnpm --filter @sveltesentio/charts test`      |

## Related ADRs

- [ADR-0013](../../docs/adr/0013-layerchart-charts-with-uplot-escape-hatch.md) — LayerChart v2-next primary + uPlot escape hatch + a11y wrapper.
- [ADR-0052](../../docs/adr/0052-clock-injection-hybrid.md) — clock injection for time-axis formatters.
