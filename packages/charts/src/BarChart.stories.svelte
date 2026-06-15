<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import BarChart from './BarChart.svelte';
	import type { CartesianSeries } from './chart-series.js';
	import type { ChartAccessors } from './a11y-table.js';

	interface RegionPoint {
		region: string;
		v: number | null;
	}

	const accessors: ChartAccessors<RegionPoint> = { x: (d) => d.region, y: (d) => d.v };

	const series: CartesianSeries<RegionPoint>[] = [
		{
			key: 'q1',
			label: 'Q1',
			data: [
				{ region: 'NA', v: 320 },
				{ region: 'EU', v: 280 },
				{ region: 'APAC', v: 190 },
				{ region: 'LATAM', v: 90 },
			],
		},
		{
			key: 'q2',
			label: 'Q2',
			data: [
				{ region: 'NA', v: 360 },
				{ region: 'EU', v: 310 },
				{ region: 'APAC', v: 240 },
				{ region: 'LATAM', v: 120 },
			],
		},
	];

	const single: CartesianSeries<RegionPoint>[] = [
		{ key: 'q1', label: 'Q1', data: series[0].data },
	];

	const { Story } = defineMeta({
		title: 'charts/BarChart',
		component: BarChart,
		tags: ['autodocs'],
		args: {
			title: 'Revenue by region',
			series,
			accessors,
		},
	});
</script>

<!-- Single vertical series (default orientation). -->
<Story
	name="Single series"
	args={{
		title: 'Revenue by region',
		description: 'Q1 revenue per region, in thousands.',
		series: single,
		accessors,
	}}
/>

<!-- Two series rendered side-by-side. -->
<Story
	name="Grouped"
	args={{ title: 'Revenue by region (Q1 vs Q2)', series, accessors, seriesLayout: 'group' }}
/>

<!-- Stacked, laid out horizontally. -->
<Story
	name="Horizontal stacked"
	args={{
		title: 'Revenue by region',
		series,
		accessors,
		orientation: 'horizontal',
		seriesLayout: 'stack',
	}}
/>
