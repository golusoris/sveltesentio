<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import LineChart from './LineChart.svelte';
	import type { CartesianSeries } from './chart-series.js';
	import type { ChartAccessors } from './a11y-table.js';

	// A typed weekday point: `t` is the x category, `v` the y value.
	interface DayPoint {
		t: string;
		v: number | null;
	}

	const accessors: ChartAccessors<DayPoint> = { x: (d) => d.t, y: (d) => d.v };

	const series: CartesianSeries<DayPoint>[] = [
		{
			key: 'sessions',
			label: 'Sessions',
			data: [
				{ t: 'Mon', v: 1200 },
				{ t: 'Tue', v: 1800 },
				{ t: 'Wed', v: 1600 },
				{ t: 'Thu', v: 2400 },
				{ t: 'Fri', v: 2100 },
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
				{ t: 'Fri', v: 15 },
			],
		},
	];

	const single: CartesianSeries<DayPoint>[] = [series[0]];

	const { Story } = defineMeta({
		title: 'charts/LineChart',
		component: LineChart,
		tags: ['autodocs'],
		args: {
			title: 'Daily sessions',
			series,
			accessors,
		},
	});
</script>

<!-- Two series, each colored from the semantic oklch palette; the visually
     hidden SR table is generated from the same series + accessors. -->
<Story name="Multi series" args={{ title: 'Daily sessions vs errors', series, accessors }} />

<!-- A single series with a one-sentence aria-describedby summary. -->
<Story
	name="With description"
	args={{
		title: 'Daily sessions',
		description: 'Authenticated sessions per weekday.',
		series: single,
		accessors,
	}}
/>

<!-- Swap the value axis to the x-axis. -->
<Story
	name="Vertical orientation"
	args={{ title: 'Daily sessions', series: single, accessors, orientation: 'vertical' }}
/>
