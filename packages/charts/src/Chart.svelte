<!--
@component
Chart — the low-level escape hatch (ADR-0013). Re-exports LayerChart's `Chart`
primitive wrapped in the mandatory <ChartFigure> a11y envelope so a custom
composition (annotations, multiple layers, exotic marks) still ships the
required text alternative. The caller renders LayerChart marks via the `chart`
snippet, which receives nothing — compose `Svg` / `Axis` / `Spline` etc. from
`layerchart` inside it. The SR data table is built from the same {series, x, y}
the caller draws, so the two cannot drift.

Kept thin: this package does not pin LayerChart's volatile v2-next API beyond
the simplified-chart `data` prop; the visual is entirely the caller's.
-->
<script lang="ts" generics="TDatum">
	import ChartFigure from './ChartFigure.svelte';
	import type {
		ChartSeries,
		ChartAccessors,
		BuildTableOptions,
	} from './a11y-table.js';
	import type { Snippet } from 'svelte';

	interface Props<T> {
		/** Accessible name for the figure — required (no anonymous charts). */
		title: string;
		/** Optional one-sentence semantic summary, exposed via `aria-describedby`. */
		description?: string;
		/** The series rendered by the chart, reused to build the SR table. */
		series: readonly ChartSeries<T>[];
		/** x / y accessors for the SR data-table cells. */
		accessors: ChartAccessors<T>;
		/** SR-table formatting / labelling options. */
		tableOptions?: BuildTableOptions<T>;
		/** Whether to render the visually-hidden SR data table. Default `true`. */
		showDataTable?: boolean;
		/** Stable id prefix for aria wiring; auto-derived from the title if omitted. */
		idBase?: string;
		/** The visual — compose `layerchart` marks here. */
		chart: Snippet;
	}

	const {
		title,
		description,
		series,
		accessors,
		tableOptions,
		showDataTable,
		idBase,
		chart,
	}: Props<TDatum> = $props();
</script>

<ChartFigure
	{title}
	{description}
	{series}
	{accessors}
	{tableOptions}
	{showDataTable}
	{idBase}
	{chart}
/>
