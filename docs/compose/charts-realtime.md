# Charts — realtime escape hatch (uPlot)

Default charts are LayerChart v2-next via shadcn Chart
([charts.md](charts.md)). SVG + Svelte 5 reactivity degrades past the
thresholds in [ADR-0013](../adr/0013-layerchart-charts-with-uplot-escape-hatch.md):

```text
≤5k visible points, <30 Hz refresh → LayerChart (default)
>5k points OR ≥30 Hz streaming      → uPlot (this recipe)
```

uPlot is a canvas-only, ~40 KB minified library with a different
authoring model — imperative, no reactivity — so the compose story is
different from LayerChart's shadcn path. This recipe documents the
`<RealtimeChart>` wrapper pattern that keeps the a11y contract from
[charts.md](charts.md) while handing hot rendering to canvas.

## When to reach for it

- Observability panels (request rate, CPU, WS throughput) with ≥30 Hz
  ticks.
- Sensor / IoT streams with >5k visible samples.
- Scrubbing / zoom on large historical series.

Keep LayerChart for static dashboards, print/export, treemaps, and any
chart ≤5k points ticking <30 Hz. Mixing is normal — observability
page has 6 LayerChart summary cards + 2 uPlot live panels.

## Install

```bash
pnpm add uplot
```

Peer: `uplot@^1.6`. No Svelte adapter — wrap it yourself. The wrapper
is small and app-owned; no `uplot-svelte` third-party (stale, pre-runes).

## Wrapper shape

```svelte
<!-- src/lib/charts/RealtimeChart.svelte -->
<script lang="ts">
  import uPlot, { type Options, type AlignedData } from 'uplot';
  import 'uplot/dist/uPlot.min.css';
  import { onMount, onDestroy } from 'svelte';

  type Props = {
    data: AlignedData;          // [timestamps, ...series]
    options: Options;
    title: string;              // a11y — never skip
    description: string;        // a11y — sr-only summary
    class?: string;
  };

  let { data, options, title, description, class: className }: Props = $props();

  let el: HTMLDivElement;
  let plot: uPlot | null = null;
  const descId = `chart-desc-${crypto.randomUUID()}`;

  onMount(() => {
    plot = new uPlot(options, data, el);
    const ro = new ResizeObserver(([entry]) => {
      plot?.setSize({ width: entry.contentRect.width, height: options.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  });

  onDestroy(() => plot?.destroy());

  $effect(() => {
    if (plot) plot.setData(data);
  });
</script>

<figure role="img" aria-labelledby="{descId}-title" aria-describedby={descId}>
  <figcaption id="{descId}-title" class="sr-only">{title}</figcaption>
  <p id={descId} class="sr-only">{description}</p>
  <div bind:this={el} class={className}></div>
  <!-- Off-screen table fallback for SR users -->
  <table class="sr-only">
    <caption>{title} data</caption>
    <thead><tr><th>Time</th>{#each options.series.slice(1) as s}<th>{s.label}</th>{/each}</tr></thead>
    <tbody>
      {#each data[0] as t, i}
        <tr>
          <td>{new Date(t * 1000).toISOString()}</td>
          {#each data.slice(1) as series}<td>{series[i]}</td>{/each}
        </tr>
      {/each}
    </tbody>
  </table>
</figure>
```

Same a11y contract as [charts.md](charts.md)'s `AccessibleChart`:
`role="img"` + `<figcaption>` + sr-only `<p>` + off-screen `<table>`.
uPlot's canvas is opaque to SR — the table is non-optional.

For streams, sample the table to the last ~100 points. A 5k-row
off-screen table hurts axe-core run time and SR nav. Trim with:

```ts
const tableData = $derived.by(() => {
  const stride = Math.max(1, Math.floor(data[0].length / 100));
  return data.map((s) => s.filter((_, i) => i % stride === 0));
});
```

## Live-feed pattern

```svelte
<script lang="ts">
  import RealtimeChart from '$lib/charts/RealtimeChart.svelte';
  import type { AlignedData } from 'uplot';

  const MAX = 5_000;
  let times = $state<number[]>([]);
  let values = $state<number[]>([]);

  $effect(() => {
    const es = new EventSource('/metrics/stream');
    es.onmessage = (e) => {
      const { t, v } = JSON.parse(e.data);
      times.push(t);
      values.push(v);
      if (times.length > MAX) {
        times.splice(0, times.length - MAX);
        values.splice(0, values.length - MAX);
      }
    };
    return () => es.close();
  });

  const data = $derived<AlignedData>([times, values]);
</script>

<RealtimeChart
  {data}
  title="Request rate"
  description="Requests per second, last 5 minutes, live stream."
  options={{
    width: 800,
    height: 280,
    series: [
      {},
      { label: 'rps', stroke: 'oklch(var(--color-chart-1))', width: 1 },
    ],
    scales: { x: { time: true } },
    axes: [
      { stroke: 'oklch(var(--color-fg) / 0.6)' },
      { stroke: 'oklch(var(--color-fg) / 0.6)' },
    ],
  }}
/>
```

Buffer cap (`MAX = 5_000`) — the whole point of uPlot is that 5k
redraws per tick are cheap. Don't unbounded-grow — memory + table
fallback both suffer.

## Incremental updates (vs full replace)

`setData(data)` re-uploads the full series. For high-frequency ticks
(>60 Hz), batch updates via `requestAnimationFrame`:

```ts
let pending = false;
function scheduleUpdate() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    plot?.setData(data);
    pending = false;
  });
}
```

Svelte's `$effect` already runs on micro-tasks, which coalesces bursts
up to ~120 Hz on most hardware. Only hand-schedule if profiling shows
>5% main-thread time in `setData`.

## Zoom / pan / crosshair

uPlot ships these via opts. Keyboard support is **not** built in —
wrap with keyboard handlers on the figure:

```svelte
<figure
  role="img"
  tabindex="0"
  onkeydown={(e) => {
    if (e.key === 'ArrowLeft') plot?.setScale('x', shift(-1));
    if (e.key === 'ArrowRight') plot?.setScale('x', shift(1));
    if (e.key === 'Home') plot?.setScale('x', reset);
  }}
>
```

WCAG 2.2 AA — chart keyboard nav is mandatory for interactive charts.
The table fallback satisfies the static contract; keyboard nav is for
peer-equivalent interaction.

## Tokens

uPlot styles via inline options + a small CSS file. Bridge oklch
tokens:

```ts
const css = getComputedStyle(document.documentElement);
const chart1 = css.getPropertyValue('--color-chart-1');
// options.series[1].stroke = `oklch(${chart1})`;
```

Wrap as a helper in `$lib/charts/tokens.ts` so every uPlot chart picks
the same palette. Don't inline hex — breaks theming (see
[theming.md](theming.md)).

## Reduced motion

`prefers-reduced-motion: reduce` should halt auto-scroll:

```ts
const reduceMotion = $state(false);
$effect(() => {
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  reduceMotion = mq.matches;
  mq.addEventListener('change', (e) => (reduceMotion = e.matches));
});

$effect(() => {
  if (plot && !reduceMotion) plot.setData(data);
});
```

Paused auto-scroll still accepts new data on the buffer; next render
catches up when the user disables reduced-motion or interacts.

## Dark mode

uPlot canvas doesn't respect CSS `color-scheme`. Rebuild on theme
change:

```ts
$effect(() => {
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const rebuild = () => {
    plot?.destroy();
    plot = new uPlot(themedOptions(), data, el);
  };
  mq.addEventListener('change', rebuild);
  return () => mq.removeEventListener('change', rebuild);
});
```

`themedOptions()` reads the oklch tokens fresh. Cost is ~1 frame on
theme flip — negligible.

## Bundle / lazy loading

uPlot is small (~40 KB min + 10 KB CSS) but still not worth shipping
on pages that don't need it. Dynamic import:

```svelte
<script lang="ts">
  let Chart = $state<typeof import('$lib/charts/RealtimeChart.svelte').default | null>(null);
  onMount(async () => {
    ({ default: Chart } = await import('$lib/charts/RealtimeChart.svelte'));
  });
</script>

{#if Chart}<Chart {data} {options} {title} {description} />{/if}
```

## Testing

```ts
import { render } from '@testing-library/svelte';
import { axe } from 'jest-axe';
import RealtimeChart from '$lib/charts/RealtimeChart.svelte';

test('RealtimeChart is axe-clean', async () => {
  const data: [number[], number[]] = [[1, 2, 3], [10, 12, 11]];
  const { container } = render(RealtimeChart, {
    props: {
      data,
      title: 'Test',
      description: 'Test chart',
      options: {
        width: 400,
        height: 200,
        series: [{}, { label: 'v' }],
      },
    },
  });
  expect(await axe(container)).toHaveNoViolations();
});
```

Visual regression: Playwright snapshot the figure with `maskColor` on
the canvas (canvas pixels vary with GPU). Assert the table fallback
content instead:

```ts
await expect(page.locator('table.sr-only')).toContainText('Time');
```

## Anti-patterns

- **Using uPlot as the default.** Canvas-only; no SVG export. Tokens
  require manual bridging. Overshoot for static charts. LayerChart is
  the default per ADR-0013.
- **Skipping the table fallback.** uPlot canvas is opaque to screen
  readers. No fallback = WCAG 1.1.1 fail.
- **Unbounded buffer growth.** Stream without `MAX` cap → OOM on long
  sessions.
- **Inline hex colors.** Breaks theming. Always bridge via oklch
  tokens (see [theming.md](theming.md)).
- **`setData` per incoming event without batching.** At >60 Hz the
  browser coalesces but not gracefully — `requestAnimationFrame` or
  Svelte micro-task batching.
- **Mutating `data` with `push` without re-assigning.** uPlot reads
  the array reference — mutation without a new `$derived` won't
  trigger `setData`.
- **Skipping keyboard nav on interactive uPlot charts.** Zoom / pan
  must be keyboard-reachable. WCAG 2.1.1 fail.
- **Using `uplot-svelte` npm package.** Pre-runes, stale. Wrap
  directly — it's ~30 lines.

## References

- ADR-0013 — LayerChart + uPlot escape hatch.
- [charts.md](charts.md) — default LayerChart path + `AccessibleChart`
  contract.
- uPlot: <https://github.com/leeoniya/uPlot>.
- uPlot demos: <https://leeoniya.github.io/uPlot/demos/>.
