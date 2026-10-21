<!--
@component
BarChart — semantic bar chart over LayerChart's simplified `BarChart`, wrapped
in <ChartFigure> for the WCAG a11y envelope (ADR-0013); supports grouped and
stacked layouts.
-->
<script lang="ts" generics="TDatum">
	import { BarChart as LcBarChart } from 'layerchart';
	import ChartFigure from './internal/CartesianChartFigure.svelte';
	import type { CartesianChartBaseProps } from './chart-series.js';

	interface Props<T> extends CartesianChartBaseProps<T> {
		/** Which axis is the value axis. @default 'vertical' */
		orientation?: 'horizontal' | 'vertical' | undefined;
		/** How multiple series lay out. @default 'overlap' */
		seriesLayout?: 'overlap' | 'stack' | 'stackExpand' | 'stackDiverging' | 'group' | undefined;
	}

	const {
		orientation = 'vertical',
		seriesLayout = 'overlap',
		...figureProps
	}: Props<TDatum> = $props();
</script>

<ChartFigure {...figureProps}>
	{#snippet chart({ lcSeries, padding, accessors })}
		<LcBarChart
			x={accessors.x}
			y={accessors.y}
			series={lcSeries}
			{orientation}
			{seriesLayout}
			{padding}
		/>
	{/snippet}
</ChartFigure>
