<!--
@component
ScatterChart — semantic scatter plot over LayerChart's simplified
`ScatterChart`, wrapped in <ChartFigure> for the WCAG a11y envelope
(ADR-0013). Plots one point cluster per series, without connecting lines.
-->
<script lang="ts" generics="TDatum">
	import { ScatterChart as LcScatterChart } from 'layerchart';
	import ChartFigure from './internal/CartesianChartFigure.svelte';
	import type { CartesianChartBaseProps, CartesianSeries } from './chart-series.js';

	interface Props<T> extends CartesianChartBaseProps<T> {
		/** One or more point clusters; each gets a palette color unless it sets `color`. */
		series: readonly CartesianSeries<T>[];
	}

	const figureProps: Props<TDatum> = $props();
</script>

<ChartFigure {...figureProps}>
	{#snippet chart({ lcSeries, padding, accessors })}
		<LcScatterChart x={accessors.x} y={accessors.y} series={lcSeries} {padding} />
	{/snippet}
</ChartFigure>
