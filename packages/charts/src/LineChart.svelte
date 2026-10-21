<!--
@component
LineChart — semantic line chart over LayerChart's simplified `LineChart`,
wrapped in <ChartFigure> for the WCAG a11y envelope (ADR-0013). Draws one line per series;
`orientation` picks which axis carries the values.
-->
<script lang="ts" generics="TDatum">
	import { LineChart as LcLineChart } from 'layerchart';
	import ChartFigure from './internal/CartesianChartFigure.svelte';
	import type { CartesianChartBaseProps } from './chart-series.js';

	interface Props<T> extends CartesianChartBaseProps<T> {
		/** Swap which axis is the value axis. @default 'horizontal' */
		orientation?: 'horizontal' | 'vertical' | undefined;
	}

	const { orientation = 'horizontal', ...figureProps }: Props<TDatum> = $props();
</script>

<ChartFigure {...figureProps}>
	{#snippet chart({ lcSeries, padding, accessors })}
		<LcLineChart x={accessors.x} y={accessors.y} series={lcSeries} {orientation} {padding} />
	{/snippet}
</ChartFigure>
