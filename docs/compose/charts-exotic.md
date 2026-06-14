# Charts — exotic escape hatch (svelte-echarts, held opt-in)

Default charts: **LayerChart v2-next via shadcn Chart** per
[charts.md](charts.md). Realtime / high-frequency: **uPlot** canvas
escape hatch per [charts-realtime.md](charts-realtime.md). This recipe
documents a **third**, held opt-in: `svelte-echarts` wrapping Apache
ECharts for chart types LayerChart does not cover.

Per [ADR-0013](../adr/0013-layerchart-charts-with-uplot-escape-hatch.md)
this dep is **not locked** in the sveltesentio stack; a future app that
surfaces a concrete need (a compliance-required candlestick board, a
dashboard gauge panel, a 3D scatter) is what promotes it. Until then,
`svelte-echarts` ships per-app via this recipe — not as a framework
dependency.

## Related

- [charts.md](charts.md) — LayerChart default path + `AccessibleChart`
  a11y contract.
- [charts-realtime.md](charts-realtime.md) — uPlot canvas escape hatch
  for >5k-point / ≥30 Hz streaming.
- [theming.md](theming.md) — oklch token pipeline (must bridge manually
  for ECharts).
- [a11y-audit-runbook.md](a11y-audit-runbook.md) — axe-core triage
  workflow (ECharts a11y primitives need manual opt-in).
- [ADR-0013](../adr/0013-layerchart-charts-with-uplot-escape-hatch.md) —
  chart-library decision.
- [ADR-0031](../adr/0031-a11y-testing-lane.md) — a11y testing lane.

## When to use what

```text
Line / bar / area / scatter / pie                → LayerChart (charts.md)
Treemap / sankey / force / geo                   → LayerChart (covers these)
>5k points OR ≥30 Hz streaming                   → uPlot (charts-realtime.md)
Candlestick / OHLC financial                     → svelte-echarts (this recipe)
Gauge / dial                                     → svelte-echarts (this recipe)
3D scatter / 3D surface / 3D bar                 → svelte-echarts (this recipe)
Radar with custom polar axes                     → svelte-echarts (this recipe)
```

If LayerChart or uPlot covers the chart type, **use them**. The cost of
`svelte-echarts` is real:

- **Bundle**: 4–6× heavier than LayerChart even tree-shaken; full ECharts
  is ~1 MB gzipped, minimum cherry-picked `core + LineChart + GridComponent`
  is ~180 KB.
- **A11y**: ECharts' `aria.enabled` / `aria.decal` primitives are **not**
  exposed by the `svelte-echarts` wrapper — you opt into them via the
  raw `option` object, otherwise you get zero SR support.
- **Tokens**: No oklch / `@theme` binding; you read CSS vars yourself
  and re-hydrate the `option` on theme change.

## Install

```bash
pnpm add echarts svelte-echarts
```

Peers: `echarts@^5.5`, `svelte-echarts@^1.0.0-rc.0` (runes-native RC
line). Tree-shake explicitly — never `import 'echarts'` (ships the full
1 MB bundle).

```ts
// src/lib/charts/echarts.ts — shared minimal ECharts build
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { CandlestickChart, GaugeChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  TitleComponent,
  AriaComponent,
  DataZoomComponent,
} from 'echarts/components';

use([
  CanvasRenderer,
  CandlestickChart,
  GaugeChart,
  GridComponent,
  TooltipComponent,
  TitleComponent,
  AriaComponent,
  DataZoomComponent,
]);

export { init } from 'echarts/core';
```

`AriaComponent` is **required** — without it, `option.aria.enabled = true`
is a silent no-op.

## Component pattern — candlestick

```svelte
<!-- src/lib/charts/CandlestickChart.svelte -->
<script lang="ts">
  import { Chart } from 'svelte-echarts';
  import { init } from '$lib/charts/echarts';
  import type { EChartsOption } from 'echarts';

  type OHLC = { t: string; o: number; h: number; l: number; c: number };
  type Props = {
    data: OHLC[];
    title: string;
    description: string;
  };

  let { data, title, description }: Props = $props();
  const descId = `chart-desc-${crypto.randomUUID()}`;

  const themed = $state<{ fg: string; up: string; down: string }>({
    fg: '',
    up: '',
    down: '',
  });

  $effect(() => {
    const css = getComputedStyle(document.documentElement);
    themed.fg = `oklch(${css.getPropertyValue('--color-fg').trim()})`;
    themed.up = `oklch(${css.getPropertyValue('--color-success').trim()})`;
    themed.down = `oklch(${css.getPropertyValue('--color-danger').trim()})`;

    const mq = matchMedia('(prefers-color-scheme: dark)');
    const refresh = () => {
      const c = getComputedStyle(document.documentElement);
      themed.fg = `oklch(${c.getPropertyValue('--color-fg').trim()})`;
      themed.up = `oklch(${c.getPropertyValue('--color-success').trim()})`;
      themed.down = `oklch(${c.getPropertyValue('--color-danger').trim()})`;
    };
    mq.addEventListener('change', refresh);
    return () => mq.removeEventListener('change', refresh);
  });

  const option = $derived<EChartsOption>({
    aria: {
      enabled: true,
      label: { description: `${title}. ${description}` },
      decal: { show: true },
    },
    title: { text: title, textStyle: { color: themed.fg } },
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
    xAxis: {
      type: 'category',
      data: data.map((d) => d.t),
      axisLine: { lineStyle: { color: themed.fg } },
    },
    yAxis: {
      scale: true,
      axisLine: { lineStyle: { color: themed.fg } },
      splitLine: { lineStyle: { color: themed.fg, opacity: 0.1 } },
    },
    dataZoom: [
      { type: 'inside', start: 50, end: 100 },
      { type: 'slider', start: 50, end: 100 },
    ],
    series: [
      {
        name: 'OHLC',
        type: 'candlestick',
        data: data.map((d) => [d.o, d.c, d.l, d.h]),
        itemStyle: {
          color: themed.up,
          color0: themed.down,
          borderColor: themed.up,
          borderColor0: themed.down,
        },
      },
    ],
  });
</script>

<figure role="img" aria-labelledby="{descId}-title" aria-describedby={descId}>
  <figcaption id="{descId}-title" class="sr-only">{title}</figcaption>
  <p id={descId} class="sr-only">{description}</p>
  <Chart {init} {option} style="width: 100%; height: 400px;" />
  <table class="sr-only">
    <caption>{title} data</caption>
    <thead>
      <tr><th>Time</th><th>Open</th><th>High</th><th>Low</th><th>Close</th></tr>
    </thead>
    <tbody>
      {#each data as row}
        <tr>
          <td>{row.t}</td>
          <td>{row.o}</td>
          <td>{row.h}</td>
          <td>{row.l}</td>
          <td>{row.c}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</figure>
```

Three a11y invariants mirror [charts-realtime.md](charts-realtime.md):

1. `<figure role="img">` + `<figcaption>` + sr-only description.
2. Off-screen `<table>` fallback — ECharts canvas is opaque to SRs.
3. `option.aria.enabled` + `aria.decal.show` for pattern-encoded series
   (color-blind support; WCAG 1.4.1).

Without `AriaComponent` in the `use([...])` call, `option.aria` is
ignored. Without the table, the chart fails WCAG 1.1.1.

## Gauge pattern

```svelte
<script lang="ts">
  import { Chart } from 'svelte-echarts';
  import { init } from '$lib/charts/echarts';
  import type { EChartsOption } from 'echarts';

  type Props = { value: number; max: number; title: string; description: string };
  let { value, max, title, description }: Props = $props();

  const option = $derived<EChartsOption>({
    aria: { enabled: true, label: { description: `${title}. ${description}. Value ${value} of ${max}.` } },
    series: [
      {
        type: 'gauge',
        min: 0,
        max,
        progress: { show: true, width: 18 },
        axisLine: { lineStyle: { width: 18 } },
        detail: { formatter: '{value}', fontSize: 24 },
        data: [{ value, name: title }],
      },
    ],
  });
</script>

<figure role="img" aria-label="{title}: {value} of {max}">
  <Chart {init} {option} style="width: 300px; height: 300px;" />
  <p class="sr-only">{description}. Current value: {value} of {max}.</p>
</figure>
```

Gauges are single-value snapshots — the `aria-label` carries the full
semantic, no table fallback needed.

## 3D charts

3D requires a separate `echarts-gl` peer:

```bash
pnpm add echarts-gl
```

```ts
import 'echarts-gl';
import { use } from 'echarts/core';
import { Grid3DComponent } from 'echarts/components';
use([Grid3DComponent]);
```

3D charts fail all screen-reader patterns — the semantic model doesn't
map to a table. Reach for 3D **only** when:

- 2D projection (scatter matrix, parallel coords) loses information
  that is material to the task.
- An accessible 2D companion chart is provided adjacent.

Otherwise, ship 2D — 3D is rarely the right answer.

## oklch theme bridge

ECharts has no CSS-variable binding. Read tokens at runtime:

```ts
function readTokens() {
  const css = getComputedStyle(document.documentElement);
  return {
    fg: `oklch(${css.getPropertyValue('--color-fg').trim()})`,
    bg: `oklch(${css.getPropertyValue('--color-bg').trim()})`,
    chart1: `oklch(${css.getPropertyValue('--color-chart-1').trim()})`,
    chart2: `oklch(${css.getPropertyValue('--color-chart-2').trim()})`,
  };
}
```

Re-read on every theme flip (`matchMedia('(prefers-color-scheme: dark)')`
change) and re-derive the `option` — `$derived` handles it if the token
state is in a `$state` rune.

Never hard-code hex / HSL inside an ECharts `option` — it breaks
[theming.md](theming.md)'s three-tier override and
[tenant-theming.md](tenant-theming.md) tenant overrides.

## Bundle + lazy loading

`svelte-echarts` + minimal ECharts build + one chart type = ~180 KB
gzipped. Full build with all types = ~1 MB. Always dynamic-import:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';

  let Candlestick = $state<typeof import('$lib/charts/CandlestickChart.svelte').default | null>(null);

  onMount(async () => {
    ({ default: Candlestick } = await import('$lib/charts/CandlestickChart.svelte'));
  });

  let { data, title, description } = $props();
</script>

{#if Candlestick}
  <Candlestick {data} {title} {description} />
{:else}
  <p role="status" aria-live="polite">Loading chart…</p>
{/if}
```

Pages that don't need candlesticks / gauges / 3D must not pay the
bundle cost. Route-level code-split via SvelteKit dynamic components
or `onMount`-gated imports.

## Reduced motion

ECharts animates series entry by default. Honour
`prefers-reduced-motion`:

```ts
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const option = $derived<EChartsOption>({
  animation: !reduceMotion,
  animationDuration: reduceMotion ? 0 : 300,
  // …
});
```

Watch the media query for live flips same as [charts-realtime.md](charts-realtime.md).

## Testing

```ts
import { render } from '@testing-library/svelte';
import { axe } from 'jest-axe';
import CandlestickChart from '$lib/charts/CandlestickChart.svelte';

test('candlestick chart is axe-clean', async () => {
  const data = [{ t: '2026-01-01', o: 100, h: 110, l: 95, c: 105 }];
  const { container } = render(CandlestickChart, {
    props: { data, title: 'AAPL', description: 'Daily OHLC, January 2026.' },
  });
  expect(await axe(container)).toHaveNoViolations();
});

test('table fallback is populated', () => {
  const data = [{ t: '2026-01-01', o: 100, h: 110, l: 95, c: 105 }];
  const { getByText } = render(CandlestickChart, {
    props: { data, title: 'AAPL', description: 'Daily OHLC.' },
  });
  expect(getByText('2026-01-01')).toBeInTheDocument();
  expect(getByText('110')).toBeInTheDocument();
});
```

Canvas pixels are GPU-variant — Playwright visual-regression must mask
the canvas region (same pattern as
[charts-realtime.md](charts-realtime.md)) and assert on the table
fallback text instead.

## Anti-patterns

- **svelte-echarts as the default chart library.** 4–6× bundle penalty
  versus LayerChart. ADR-0013 locks LayerChart as default.
- **`import 'echarts'` full-bundle.** Ships all ~50 chart types. Always
  cherry-pick via `echarts/core` + explicit `use([...])`.
- **Skipping `AriaComponent` in `use([...])`.** `option.aria.enabled`
  silently no-ops. Zero SR support.
- **Skipping the off-screen table.** Canvas opaque to SRs. WCAG 1.1.1
  fail — same rule as [charts-realtime.md](charts-realtime.md).
- **Hex / HSL / raw oklch literals in `option`.** Breaks theming
  three-tier cascade. Always bridge via `getComputedStyle`.
- **No `matchMedia` listener for theme flips.** Chart stays in the old
  palette after theme toggle. Re-derive `option` from the token state.
- **`aria.decal.show: false`.** Pattern-based encoding is mandatory for
  series charts to satisfy WCAG 1.4.1 (color alone not the sole means).
- **Always-bundle.** Candlestick / gauge / 3D pages are rare — pay the
  180 KB only on routes that use them. Dynamic-import.
- **3D without a 2D companion.** 3D fails screen-reader semantics
  entirely. Only ship when 2D loses material information, and always
  adjacent to an accessible 2D view.
- **`animation: true` without `prefers-reduced-motion` gate.** WCAG
  2.3.3 — honour the media query.
- **Treating this as a framework dep.** `svelte-echarts` is per-app
  until a concrete sveltesentio need promotes it — do not add to
  `@sveltesentio/ui` peer deps.

## References

- [ADR-0013](../adr/0013-layerchart-charts-with-uplot-escape-hatch.md) —
  LayerChart default, uPlot realtime, svelte-echarts held.
- [charts.md](charts.md) — LayerChart default path.
- [charts-realtime.md](charts-realtime.md) — uPlot canvas escape hatch.
- [theming.md](theming.md) — oklch token pipeline.
- [a11y-audit-runbook.md](a11y-audit-runbook.md) — axe-core triage.
- Apache ECharts: <https://echarts.apache.org/>.
- svelte-echarts: <https://github.com/bherbruck/svelte-echarts>.
- ECharts a11y (aria/decal): <https://echarts.apache.org/en/option.html#aria>.
