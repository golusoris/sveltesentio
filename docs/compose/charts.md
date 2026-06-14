# Charts — LayerChart v2-next via shadcn + `@sveltesentio/ui/chart` a11y wrapper

Default: **LayerChart v2-next** installed via shadcn-svelte's `Chart`
primitive. The `@sveltesentio/ui/chart` wrapper adds the a11y envelope
that upstream libraries don't enforce — `role="img"`, SR table fallback,
`prefers-reduced-motion`, `<figure>` + `<figcaption>`. For >5k-point or
≥30 Hz streaming, drop into the uPlot escape hatch (see
[charts-realtime.md](charts-realtime.md) pending).

See [ADR-0013](../adr/0013-layerchart-charts-with-uplot-escape-hatch.md)
for the decision. Related: [theming.md](theming.md) (oklch token
pipeline), [ADR-0006](../adr/0006-oklch-only-color-tokens.md) (color
tokens), [ADR-0031](../adr/0031-a11y-testing-lane.md) (axe-core lane).

## When to use what

```text
≤5k points, not streaming          → LayerChart via shadcn Chart (default)
>5k points OR ≥30 Hz streaming     → uPlot (charts-realtime.md)
Candlestick / gauge / 3D only      → svelte-echarts (charts-exotic.md, held)
```

Use LayerChart for every admin dashboard, reporting surface, and
observability panel under the threshold. uPlot is the canvas-only escape
hatch — only reach for it when SVG's point ceiling or frame rate hurts.

## Install

```bash
pnpm dlx shadcn-svelte@latest add chart
# Installs `layerchart@next` + generates src/lib/components/ui/chart/*
pnpm add @sveltesentio/ui
```

LayerChart v2-next is pre-release (`next.53…next.57` shipped in 8 days
as of 2026-04-17); pin carefully. The shadcn generator pins a specific
`next.NN` — don't bump blindly.

## Basic line chart

```svelte
<!-- src/routes/dashboard/+page.svelte -->
<script lang="ts">
  import { Chart, Svg, Axis, Spline, Tooltip } from 'layerchart';
  import { AccessibleChart } from '@sveltesentio/ui/chart';
  import { scaleTime, scaleLinear } from 'd3-scale';

  let { data } = $props(); // data.points: { t: Date; v: number }[]
</script>

<AccessibleChart
  title="Daily active users"
  description="Trailing 30 days; weekends shown in muted-fg."
  data={data.points}
>
  <Chart
    data={data.points}
    x="t"
    xScale={scaleTime()}
    y="v"
    yScale={scaleLinear()}
    yDomain={[0, null]}
    padding={{ top: 16, bottom: 32, left: 48, right: 16 }}
  >
    <Svg>
      <Axis placement="left" grid rule />
      <Axis placement="bottom" rule />
      <Spline class="stroke-accent stroke-2" />
      <Tooltip />
    </Svg>
  </Chart>
</AccessibleChart>
```

`AccessibleChart` is the wrapper layer from `@sveltesentio/ui/chart`.
It renders:

```html
<figure role="img" aria-labelledby="chart-title-…" aria-describedby="chart-desc-…">
  <figcaption id="chart-title-…">Daily active users</figcaption>
  <p id="chart-desc-…" class="sr-only">Trailing 30 days; weekends shown in muted-fg.</p>
  <!-- LayerChart SVG with <title>/<desc> injected -->
  <!-- …and an off-screen <table> sibling exposing the dataset for SRs -->
</figure>
```

The `title` prop is **required** — a chart without one fails the a11y
lint. `description` is optional but recommended for non-trivial charts.

## Colors from tokens

LayerChart v2-next reads oklch via shadcn's chart tokens:

```css
/* Already set by shadcn when you ran `add chart` */
:root {
  --color-chart-1: var(--color-accent);
  --color-chart-2: oklch(0.72 0.16 155); /* success */
  --color-chart-3: oklch(0.80 0.16 85);  /* warning */
  --color-chart-4: oklch(0.66 0.22 28);  /* danger */
  --color-chart-5: oklch(0.70 0.14 200);
}
```

Reference them through Tailwind utilities (`stroke-chart-1`, `fill-chart-2`)
or `var(--color-chart-N)` in raw CSS. Same three-tier override story as
[theming.md](theming.md) — app + tenant layers cascade naturally.

Never hard-code hex / HSL / `oklch(...)` in a chart component.

## Categorical charts (bar, stacked bar)

```svelte
<script lang="ts">
  import { Chart, Svg, Axis, Bars, Tooltip } from 'layerchart';
  import { AccessibleChart } from '@sveltesentio/ui/chart';
  import { scaleBand, scaleLinear } from 'd3-scale';

  let { data } = $props(); // { category: string; value: number }[]
</script>

<AccessibleChart
  title="Revenue by region"
  description="Q1 2026, EUR millions."
  data={data.points}
>
  <Chart
    data={data.points}
    x="category"
    xScale={scaleBand().padding(0.2)}
    y="value"
    yScale={scaleLinear()}
    yDomain={[0, null]}
    padding={{ top: 16, bottom: 48, left: 56, right: 16 }}
  >
    <Svg>
      <Axis placement="left" grid rule />
      <Axis placement="bottom" rule />
      <Bars class="fill-chart-1" radius={4} />
      <Tooltip />
    </Svg>
  </Chart>
</AccessibleChart>
```

## Reduced motion

The wrapper honors `prefers-reduced-motion: reduce` automatically —
tween durations collapse to `0ms`. LayerChart transitions without the
wrapper will animate even for users who asked not to; always compose
through `AccessibleChart`.

## Multi-series legend

```svelte
<script lang="ts">
  import { Legend } from 'layerchart';
</script>

<AccessibleChart title="CPU usage by host" data={hosts}>
  <Chart {/* … */}>
    <Svg>
      {#each hosts as host, i}
        <Spline data={host.points} class="stroke-chart-{i + 1}" />
      {/each}
    </Svg>
  </Chart>
  <Legend
    items={hosts.map((h, i) => ({ label: h.name, color: `var(--color-chart-${i + 1})` }))}
  />
</AccessibleChart>
```

Legends live outside the `<Svg>` block — they're DOM elements and get
keyboard focus / SR announcement for free.

## Treemap / sankey / geo / force

LayerChart v2-next covers these out of the box. No extra dep.

```svelte
<script lang="ts">
  import { Chart, Svg, Treemap } from 'layerchart';
  import { hierarchy, treemap as d3Treemap } from 'd3-hierarchy';
</script>

<AccessibleChart title="Storage by bucket" data={buckets}>
  <Chart data={hierarchy(buckets).sum((d) => d.size)}>
    <Svg>
      <Treemap let:nodes>
        {#each nodes as node}
          <rect
            x={node.x0}
            y={node.y0}
            width={node.x1 - node.x0}
            height={node.y1 - node.y0}
            class="fill-chart-1 stroke-bg stroke-2"
          />
        {/each}
      </Treemap>
    </Svg>
  </Chart>
</AccessibleChart>
```

## Streaming data

For real-time updates ≤5k visible points, re-render LayerChart on
`$state` change — it re-computes efficiently for SVG at this scale:

```svelte
<script lang="ts">
  let points = $state<Point[]>([]);
  const maxLen = 500;

  $effect(() => {
    const es = new EventSource('/metrics/cpu');
    es.addEventListener('tick', (e) => {
      const p = JSON.parse(e.data) as Point;
      points = [...points, p].slice(-maxLen);
    });
    return () => es.close();
  });
</script>

<AccessibleChart title="CPU (live)" data={points}>
  <Chart data={points} {/* … */}>
    <Svg><Spline class="stroke-accent" /></Svg>
  </Chart>
</AccessibleChart>
```

Above ~5k visible points or ≥30 Hz ticks, switch to uPlot — SVG
re-renders start to hurt main thread. See
[charts-realtime.md](charts-realtime.md) (pending).

## Server-rendered charts

LayerChart renders SVG, which SSRs fine. Pre-compute the dataset in
`+page.server.ts`, pass via `data`, and the first paint has the chart
inline — no client-side layout thrash.

Avoid running d3's `scaleTime()` on the server if timezone sensitivity
matters; normalize the dataset to UTC before hydration.

## Testing

Component tests with Testing Library + axe-core:

```ts
import { render } from '@testing-library/svelte';
import { axe, toHaveNoViolations } from 'jest-axe';
import MyChart from './MyChart.svelte';

expect.extend({ toHaveNoViolations });

test('MyChart is axe-clean', async () => {
  const { container } = render(MyChart, { props: { data: sample } });
  expect(await axe(container)).toHaveNoViolations();
});

test('MyChart has an accessible name', () => {
  const { getByRole } = render(MyChart, { props: { data: sample } });
  expect(getByRole('img', { name: /daily active users/i })).toBeInTheDocument();
});
```

Visual regressions via Histoire stories (`.story.svelte`) — one story
per chart variant.

## Anti-patterns

- **Using `<Chart>` without `AccessibleChart`.** Wrapper provides the
  a11y envelope. Direct `<Chart>` is the opt-out, and an a11y-lint
  violation.
- **Hard-coded colors in chart components.** Use token references
  (`stroke-chart-1` or `var(--color-chart-1)`). Hex/HSL/oklch literals
  are forbidden by lint in `packages/ui/**`.
- **Animating without `prefers-reduced-motion`.** The wrapper handles
  it; raw LayerChart transitions ignore the media query. Always compose
  through the wrapper.
- **Using uPlot as the default.** Canvas-only; no SVG print / vector
  export; `uplot-svelte` wrapper is Svelte-4 only. Default to LayerChart.
- **`@unovis/svelte`.** Peer deps `^3.48 || ^4` — no Svelte 5. Hard
  no (ADR-0013).
- **svelte-echarts for common cases.** 4–6× bundle penalty. Only use
  it for candlestick / gauge / 3D per the exotic compose recipe.
- **Relying on LayerChart's `aria-*` defaults.** They're weak at the
  library layer — always wrap.
- **SVG charts above ~5k visible points.** Main-thread re-renders hurt.
  Switch to uPlot at the threshold.

## References

- ADR-0013 — LayerChart v2-next + uPlot escape hatch + `ui/chart`
  a11y wrapper.
- ADR-0006 — oklch token pipeline (chart colors).
- ADR-0031 — a11y testing lane (axe-core on every chart story).
- LayerChart docs: <https://www.layerchart.com>.
- shadcn-svelte Chart: <https://shadcn-svelte.com/docs/components/chart>.
- uPlot: <https://github.com/leeoniya/uPlot>.
