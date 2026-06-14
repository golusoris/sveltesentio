# @sveltesentio/charts — AGENTS.md

> Dashboard chart wrappers with a11y baked in. Phase 11 per [.workingdir/PLAN.md](../../.workingdir/PLAN.md).

## Scope

Thin wrapper over **LayerChart v2-next** (via shadcn-svelte Chart) + **uPlot** escape hatch for high-frequency / >5k-point series. Composes the a11y layer that neither library ships at the wrapper level.

| Export | Purpose | ADR |
|---|---|---|
| `<LineChart>` / `<AreaChart>` / `<BarChart>` / `<PieChart>` / `<ScatterChart>` | LayerChart-backed semantic charts with oklch palette | [ADR-0013](../../docs/adr/0013-layerchart-charts-with-uplot-escape-hatch.md) |
| `<Chart>` low-level | LayerChart primitive re-export for custom compositions | — |
| `createUPlotChart()` | Escape hatch for >5k-pt or high-Hz feeds (network graphs, observability sparklines) | [docs/compose/charts-realtime.md](../../docs/compose/charts-realtime.md) (TBD) |
| `<ChartFigure>` a11y wrapper | `role="img"` + `aria-labelledby` + `<title>` / `<desc>` + off-screen `<table>` + `prefers-reduced-motion` + `<figure>` / `<figcaption>` | [ADR-0013](../../docs/adr/0013-layerchart-charts-with-uplot-escape-hatch.md) |

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

Every chart rendered through this package **must** go through `<ChartFigure>`. Bare LayerChart / uPlot render without it is an ESLint error (`@sveltesentio/chart-a11y-wrapper`).

- `role="img"` on the SVG / Canvas.
- `aria-labelledby={titleId}` referring to an `id`-bearing `<title>` element.
- `<desc>` gives the one-sentence semantic summary.
- Off-screen `<table>` renders the data as a structured alternative. `sr-only` class, focusable via summary link.
- `prefers-reduced-motion: reduce` disables entry transitions.
- `<figure>` / `<figcaption>` wraps the chart + its caption.

## Invariants — data

- **No raw `Date.now()`** in axis formatters. Use the injected clock from `@sveltesentio/core/clock` (ADR-0052) — ensures tests can deterministically snapshot axes.
- **Palette is semantic, not decorative.** `role="chart-series-1"` etc. maps to oklch tokens from `@sveltesentio/ui/tokens`.

## Test policy

- Visual regression per paradigm (admin line / observability sparkline / embedded bar / mobile pie / exploration treemap).
- a11y tests verify the off-screen table renders correct values for each chart type.
- uPlot escape hatch tests run against 100k-pt series — verify pan / zoom doesn't drop frames (playwright perf trace).

## Common tasks

| Task | Command |
|---|---|
| Typecheck | `pnpm --filter @sveltesentio/charts typecheck` |
| Unit tests | `pnpm --filter @sveltesentio/charts test` |

## Related ADRs

- [ADR-0013](../../docs/adr/0013-layerchart-charts-with-uplot-escape-hatch.md) — LayerChart v2-next primary + uPlot escape hatch + a11y wrapper.
- [ADR-0052](../../docs/adr/0052-clock-injection-hybrid.md) — clock injection for time-axis formatters.
