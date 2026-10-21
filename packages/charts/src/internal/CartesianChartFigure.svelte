<!--
@component
CartesianChartFigure — internal <ChartFigure> wiring shared by <AreaChart>,
<BarChart>, <LineChart> and <ScatterChart>. Typed `data` + `series` with the
semantic oklch palette; motion collapses under `prefers-reduced-motion`. The SR
data table is generated from the same `series` + `x`/`y` accessors that drive
the visual. The four charts import it as `ChartFigure`: the chart-a11y-wrapper
lint rule accepts layerchart marks only under an element of that name.
-->
<script lang="ts" generics="TDatum">
	import type { Snippet } from 'svelte';
	import BaseChartFigure from '../ChartFigure.svelte';
	import {
		resolveSeriesColors,
		toFigureSeries,
		type CartesianChartBaseProps,
		type LayerSeries,
	} from '../chart-series.js';
	import type { ChartAccessors } from '../a11y-table.js';
	import { dashboardPreset, prefersReducedMotion, type ChartPadding } from '../preset.js';

	interface Props<T> extends CartesianChartBaseProps<T> {
		chart: Snippet<
			[{ lcSeries: LayerSeries<T>[]; padding: ChartPadding; accessors: ChartAccessors<T> }]
		>;
	}

	const {
		title,
		description,
		series,
		accessors,
		tableOptions,
		showDataTable,
		idBase,
		chart: renderChart,
	}: Props<TDatum> = $props();

	const lcSeries = $derived(resolveSeriesColors(series));
	const figureSeries = $derived(toFigureSeries(series));
	const preset = $derived(dashboardPreset({ reducedMotion: prefersReducedMotion() }));
</script>

<BaseChartFigure
	{title}
	{description}
	series={figureSeries}
	{accessors}
	{tableOptions}
	{showDataTable}
	{idBase}
>
	{#snippet chart()}
		{@render renderChart({ lcSeries, padding: preset.padding, accessors })}
	{/snippet}
</BaseChartFigure>
