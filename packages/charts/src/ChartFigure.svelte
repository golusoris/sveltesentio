<!--
@component
ChartFigure — the mandatory a11y envelope for every chart in sveltesentio
(ADR-0013). A chart is non-text content (WCAG 2.2 SC 1.1.1); on its own it is
invisible to screen readers. This wrapper provides the required text
alternative without constraining which charting library renders the visual:

- `<figure>` / `<figcaption>` semantics with an explicit accessible name.
- `role="img"` + `aria-labelledby` (title) + `aria-describedby` (optional desc)
  on the chart region.
- A visually-hidden `<table>` generated from `{series, x, y}` so assistive tech
  reads the underlying data, kept in sync with the visual via the same model.
- A `chart` snippet (escape hatch) into which the caller renders LayerChart /
  uPlot / anything — this package does not pin LayerChart's volatile v2-next API.

Plain `tsc` does not type-check `.svelte`; the typed core lives in
`./a11y-table` and `./preset` and is unit-tested there.
-->
<script lang="ts" generics="TDatum">
  import {
    buildDataTableModel,
    type ChartSeries,
    type ChartAccessors,
    type BuildTableOptions,
  } from './a11y-table.js';
  import type { Snippet } from 'svelte';

  interface Props<T> {
    /** Accessible name for the figure — required (no anonymous charts). */
    title: string;
    /** Optional one-sentence semantic summary, exposed via `aria-describedby`. */
    description?: string;
    /** The series rendered by the chart, reused to build the SR table. */
    series: readonly ChartSeries<T>[];
    /** x / y accessors for the data table cells. */
    accessors: ChartAccessors<T>;
    /** Table formatting / labelling options. */
    tableOptions?: BuildTableOptions<T>;
    /**
     * Whether to render the visually-hidden data table. Default `true`.
     * Set `false` only when the chart already has an equivalent visible table.
     */
    showDataTable?: boolean;
    /** Stable id prefix for aria wiring; auto-derived if omitted. */
    idBase?: string;
    /** The visual chart. Receives nothing; renders LayerChart/uPlot/etc. */
    chart: Snippet;
  }

  const {
    title,
    description,
    series,
    accessors,
    tableOptions,
    showDataTable = true,
    idBase,
    chart,
  }: Props<TDatum> = $props();

  const base = $derived(idBase ?? `chart-${title.replace(/\W+/g, '-').toLowerCase()}`);
  const titleId = $derived(`${base}-title`);
  const descId = $derived(`${base}-desc`);
  const tableId = $derived(`${base}-table`);

  const table = $derived(buildDataTableModel(series, accessors, tableOptions));
</script>

<figure class="ssentio-chart-figure" aria-labelledby={titleId}>
  <figcaption id={titleId} class="ssentio-chart-figure__caption">{title}</figcaption>

  {#if description}
    <p id={descId} class="ssentio-chart-figure__desc">{description}</p>
  {/if}

  <div
    class="ssentio-chart-figure__viz"
    role="img"
    aria-labelledby={titleId}
    aria-describedby={description ? descId : undefined}
  >
    {@render chart()}
  </div>

  {#if showDataTable}
    <table id={tableId} class="ssentio-chart-figure__sr-only">
      <caption>{title} — data table</caption>
      <thead>
        <tr>
          <th scope="col">{table.xLabel}</th>
          {#each table.columns as column (column)}
            <th scope="col">{column}</th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each table.rows as row (row.x)}
          <tr>
            <th scope="row">{row.head}</th>
            {#each row.cells as cell, i (table.columns[i] ?? i)}
              <td>{cell}</td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</figure>

<style>
  .ssentio-chart-figure {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .ssentio-chart-figure__caption {
    font-weight: 600;
  }

  .ssentio-chart-figure__desc {
    margin: 0;
    font-size: 0.875rem;
    opacity: 0.8;
  }

  /* Visually-hidden but available to assistive tech (the SR fallback table). */
  .ssentio-chart-figure__sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
