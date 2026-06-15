<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import Chart from './Chart.svelte';
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
			],
		},
	];

	const { Story } = defineMeta({
		title: 'charts/Chart',
		component: Chart as unknown as typeof Chart<Point>,
		tags: ['autodocs'],
	});
</script>

<!--
Low-level escape hatch: the caller renders LayerChart marks into the required
`chart` snippet (a `Snippet` prop, so the Story body wires it directly). To keep
the story decoupled from LayerChart's volatile v2-next primitive API, the visual
is a placeholder standing in for a bespoke composition; the story's value is
showing the mandatory a11y envelope (figure + role="img" + SR data table) the
wrapper adds around whatever the caller draws.
-->
<Story name="Custom visual">
	<Chart title="Custom composition" {series} {accessors}>
		{#snippet chart()}
			<div
				style="display:flex;align-items:center;justify-content:center;height:180px;border:1px dashed currentColor;border-radius:0.5rem;opacity:0.7;"
			>
				Caller-composed LayerChart marks render here
			</div>
		{/snippet}
	</Chart>
</Story>

<!-- Same envelope with an aria-describedby summary; SR table still emitted. -->
<Story name="With description">
	<Chart
		title="Custom composition"
		description="A bespoke layered chart with the standard a11y envelope."
		{series}
		{accessors}
	>
		{#snippet chart()}
			<div
				style="display:flex;align-items:center;justify-content:center;height:180px;border:1px dashed currentColor;border-radius:0.5rem;opacity:0.7;"
			>
				Caller-composed LayerChart marks render here
			</div>
		{/snippet}
	</Chart>
</Story>
