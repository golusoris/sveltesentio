<!--
@component
ScatterChart — semantic scatter plot over LayerChart's simplified
`ScatterChart`, wrapped in <ChartFigure> for the WCAG a11y envelope
(ADR-0013). Typed `data` + `series` with the semantic oklch palette; motion
collapses under `prefers-reduced-motion`. The SR data table is generated from
the same `series` + `x`/`y` accessors that drive the visual.
-->
<script lang="ts" generics="TDatum">
	import { ScatterChart as LcScatterChart } from 'layerchart';
	import ChartFigure from './ChartFigure.svelte';
	import {
		resolveSeriesColors,
		toFigureSeries,
		type CartesianSeries,
	} from './chart-series.js';
	import type { ChartAccessors, BuildTableOptions } from './a11y-table.js';
	import { dashboardPreset, prefersReducedMotion } from './preset.js';

	interface Props<T> {
		/** Accessible name for the figure — required (no anonymous charts). */
		title: string;
		/** Optional one-sentence summary, exposed via `aria-describedby`. */
		description?: string;
		/** One or more point clusters; each gets a palette color unless it sets `color`. */
		series: readonly CartesianSeries<T>[];
		/** x / y accessors, shared across series (visual + SR table). */
		accessors: ChartAccessors<T>;
		/** SR-table formatting / labelling options. */
		tableOptions?: BuildTableOptions<T>;
		/** Whether to render the visually-hidden SR data table. @default true */
		showDataTable?: boolean;
		/** Stable id prefix for aria wiring; auto-derived from the title if omitted. */
		idBase?: string;
	}

	const {
		title,
		description,
		series,
		accessors,
		tableOptions,
		showDataTable,
		idBase,
	}: Props<TDatum> = $props();

	const lcSeries = $derived(resolveSeriesColors(series));
	const figureSeries = $derived(toFigureSeries(series));
	const preset = $derived(dashboardPreset({ reducedMotion: prefersReducedMotion() }));
</script>

<ChartFigure
	{title}
	{description}
	series={figureSeries}
	{accessors}
	{tableOptions}
	{showDataTable}
	{idBase}
>
	{#snippet chart()}
		<LcScatterChart
			x={accessors.x}
			y={accessors.y}
			series={lcSeries}
			padding={preset.padding}
		/>
	{/snippet}
</ChartFigure>
