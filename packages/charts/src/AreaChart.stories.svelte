<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import AreaChart from './AreaChart.svelte';
	import type { CartesianSeries } from './chart-series.js';
	import type { ChartAccessors } from './a11y-table.js';

	interface MonthPoint {
		month: string;
		v: number | null;
	}

	const accessors: ChartAccessors<MonthPoint> = { x: (d) => d.month, y: (d) => d.v };

	const series: CartesianSeries<MonthPoint>[] = [
		{
			key: 'free',
			label: 'Free',
			data: [
				{ month: 'Jan', v: 400 },
				{ month: 'Feb', v: 520 },
				{ month: 'Mar', v: 610 },
				{ month: 'Apr', v: 700 },
			],
		},
		{
			key: 'pro',
			label: 'Pro',
			data: [
				{ month: 'Jan', v: 120 },
				{ month: 'Feb', v: 180 },
				{ month: 'Mar', v: 260 },
				{ month: 'Apr', v: 340 },
			],
		},
	];

	const { Story } = defineMeta({
		title: 'charts/AreaChart',
		component: AreaChart,
		tags: ['autodocs'],
		args: {
			title: 'Active accounts by plan',
			series,
			accessors,
		},
	});
</script>

<!-- Default overlapping layout. -->
<Story
	name="Overlap"
	args={{ title: 'Active accounts by plan', series, accessors }}
/>

<!-- Stacked layout — areas sum vertically. -->
<Story
	name="Stacked"
	args={{
		title: 'Active accounts (stacked)',
		description: 'Free and Pro accounts stacked per month.',
		series,
		accessors,
		seriesLayout: 'stack',
	}}
/>

<!-- Proportional stack: each band normalised to 100%. -->
<Story
	name="Stack expand"
	args={{ title: 'Plan mix over time', series, accessors, seriesLayout: 'stackExpand' }}
/>
