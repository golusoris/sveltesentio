<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import ChartFigure from './ChartFigure.svelte';
	import type { ChartSeries, ChartAccessors } from './a11y-table.js';

	interface Point {
		t: string;
		v: number | null;
	}

	const accessors: ChartAccessors<Point> = { x: (d) => d.t, y: (d) => d.v };

	const series: ChartSeries<Point>[] = [
		{
			key: 'sessions',
			label: 'Sessions',
			data: [
				{ t: 'Mon', v: 1200 },
				{ t: 'Tue', v: 1800 },
				{ t: 'Wed', v: 1600 },
				{ t: 'Thu', v: 2400 },
			],
		},
		{
			key: 'errors',
			label: 'Errors',
			data: [
				{ t: 'Mon', v: 24 },
				{ t: 'Tue', v: 12 },
				{ t: 'Wed', v: 30 },
				{ t: 'Thu', v: 8 },
			],
		},
	];

	const { Story } = defineMeta({
		title: 'charts/ChartFigure',
		component: ChartFigure as unknown as typeof ChartFigure<Point>,
		tags: ['autodocs'],
	});
</script>

<!--
The mandatory a11y envelope (ADR-0013). `chart` is a required `Snippet` prop —
the library-agnostic slot any charting visual renders into — so each Story body
wires it directly with a placeholder. The visually-hidden SR `<table>` is built
from the same `series` + `accessors`, keeping the text alternative in sync with
whatever visual the caller draws.
-->
<Story name="Default">
	<ChartFigure title="Daily sessions" {series} {accessors}>
		{#snippet chart()}
			<div
				style="display:flex;align-items:center;justify-content:center;height:180px;border:1px dashed currentColor;border-radius:0.5rem;opacity:0.7;"
			>
				Visual (LayerChart / uPlot / anything) renders here
			</div>
		{/snippet}
	</ChartFigure>
</Story>

<!-- A description promotes aria-describedby on the chart region. -->
<Story name="With description">
	<ChartFigure
		title="Daily sessions"
		description="Authenticated sessions and errors per weekday."
		{series}
		{accessors}
	>
		{#snippet chart()}
			<div
				style="display:flex;align-items:center;justify-content:center;height:180px;border:1px dashed currentColor;border-radius:0.5rem;opacity:0.7;"
			>
				Visual renders here
			</div>
		{/snippet}
	</ChartFigure>
</Story>

<!-- Suppress the SR table when an equivalent visible table already exists. -->
<Story name="No data table">
	<ChartFigure title="Daily sessions" {series} {accessors} showDataTable={false}>
		{#snippet chart()}
			<div
				style="display:flex;align-items:center;justify-content:center;height:180px;border:1px dashed currentColor;border-radius:0.5rem;opacity:0.7;"
			>
				Visual renders here
			</div>
		{/snippet}
	</ChartFigure>
</Story>
