<!--
@component
AreaChart — semantic area chart over LayerChart's simplified `AreaChart`,
wrapped in <ChartFigure> for the WCAG a11y envelope (ADR-0013); supports
stacked layouts.
-->
<script lang="ts" generics="TDatum">
	import { AreaChart as LcAreaChart } from 'layerchart';
	import ChartFigure from './internal/CartesianChartFigure.svelte';
	import type { CartesianChartBaseProps } from './chart-series.js';

	interface Props<T> extends CartesianChartBaseProps<T> {
		/** How overlapping series stack. @default 'overlap' */
		seriesLayout?: 'overlap' | 'stack' | 'stackExpand' | 'stackDiverging' | undefined;
	}

	const { seriesLayout = 'overlap', ...figureProps }: Props<TDatum> = $props();
</script>

<ChartFigure {...figureProps}>
	{#snippet chart({ lcSeries, padding, accessors })}
		<LcAreaChart x={accessors.x} y={accessors.y} series={lcSeries} {seriesLayout} {padding} />
	{/snippet}
</ChartFigure>
