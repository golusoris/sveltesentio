# @sveltesentio/charts

> Thin LayerChart wrappers with a WCAG 2.2 AA accessibility envelope

Part of the [sveltesentio](https://github.com/golusoris/sveltesentio) composable SvelteKit framework.

## Status

✅ v0.2.0 — the `<ChartFigure>` accessibility wrapper, the `buildDataTableModel`
screen-reader fallback builder, and the `dashboardPreset` defaults have shipped.
The five semantic chart components and the uPlot streaming escape hatch are
follow-through (see [AGENTS.md](./AGENTS.md)).

## Why

Every charting library — LayerChart included — ships weak accessibility at the
wrapper level (ADR-0013). A chart is non-text content (WCAG 2.2 SC 1.1.1) and is
invisible to assistive tech on its own. `<ChartFigure>` is the mandatory envelope
that supplies the text alternative, independent of which library draws the pixels.

## Sub-exports

| Import                            | What                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------- |
| `@sveltesentio/charts`            | `buildDataTableModel`, `dashboardPreset`, `prefersReducedMotion` + types          |
| `@sveltesentio/charts/figure`     | `<ChartFigure>` — `<figure>` + `role="img"` + aria wiring + off-screen data table |
| `@sveltesentio/charts/a11y-table` | `buildDataTableModel` alone (zero-dep pull)                                       |
| `@sveltesentio/charts/preset`     | `dashboardPreset` + `prefersReducedMotion` alone                                  |

## Usage

```svelte
<script lang="ts">
  import ChartFigure from '@sveltesentio/charts/figure';
  import { dashboardPreset, prefersReducedMotion } from '@sveltesentio/charts/preset';
  import { Chart, Svg, Spline, Axis } from 'layerchart';

  const series = [{ key: 'sessions', label: 'Active sessions', data: points }];
  const preset = $derived(dashboardPreset({ reducedMotion: prefersReducedMotion() }));
</script>

<ChartFigure
  title="Active HLS sessions"
  description="Live count over the last hour."
  {series}
  accessors={{ x: (d) => d.t, y: (d) => d.v }}
  tableOptions={{ xLabel: 'Time' }}
>
  {#snippet chart()}
    <!-- Any LayerChart / uPlot composition. The wrapper is API-agnostic. -->
    <Chart data={series[0].data} x="t" y="v" padding={preset.padding}>
      <Svg>
        <Axis placement="left" grid={preset.grid.y} />
        <Axis placement="bottom" grid={preset.grid.x} />
        <Spline />
      </Svg>
    </Chart>
  {/snippet}
</ChartFigure>
```

The off-screen `<table>` is generated from the same `series` + `accessors`, so the
screen-reader fallback can never drift from the visual.

## Installation

```bash
pnpm add @sveltesentio/charts layerchart
```

`layerchart` is an optional peer — `@sveltesentio/charts` does not import it, so you
can render any chart library inside the `chart` snippet. Install it when you use the
documented LayerChart presets.

See the [monorepo README](../../README.md) and [`docs/`](../../docs/) for design principles and usage.

## License

MIT © lusoris
