<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import ScatterChart from './ScatterChart.svelte';
	import type { CartesianSeries } from './chart-series.js';
	import type { ChartAccessors } from './a11y-table.js';

	// Each point pairs a load (x) with a measured latency (y).
	interface Sample {
		load: number;
		latency: number | null;
	}

	const accessors: ChartAccessors<Sample> = { x: (d) => d.load, y: (d) => d.latency };

	const series: CartesianSeries<Sample>[] = [
		{
			key: 'edge',
			label: 'Edge',
			data: [
				{ load: 10, latency: 42 },
				{ load: 25, latency: 51 },
				{ load: 40, latency: 60 },
				{ load: 70, latency: 88 },
				{ load: 95, latency: 120 },
			],
		},
		{
			key: 'origin',
			label: 'Origin',
			data: [
				{ load: 10, latency: 95 },
				{ load: 25, latency: 110 },
				{ load: 40, latency: 140 },
				{ load: 70, latency: 210 },
				{ load: 95, latency: 320 },
			],
		},
	];

	const { Story } = defineMeta({
		title: 'charts/ScatterChart',
		component: ScatterChart,
		tags: ['autodocs'],
		args: {
			title: 'Latency vs load',
			series,
			accessors,
		},
	});
</script>

<!-- Two point clusters, each a palette color; the SR table unions x values. -->
<Story name="Two clusters" args={{ title: 'Latency vs load', series, accessors }} />

<!-- With an aria-describedby summary. -->
<Story
	name="With description"
	args={{
		title: 'Latency vs load',
		description: 'Measured request latency at increasing concurrent load.',
		series,
		accessors,
	}}
/>
