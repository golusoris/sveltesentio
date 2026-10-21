import type { ChartAccessors } from './a11y-table.js';
import type { CartesianSeries } from './chart-series.js';

export interface DayPoint {
	t: string;
	v: number | null;
}

export const dayAccessors: ChartAccessors<DayPoint> = {
	x: (d) => d.t,
	y: (d) => d.v,
};

export const sampleWeekdaySeries: CartesianSeries<DayPoint>[] = [
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

export const singleWeekdaySeries: CartesianSeries<DayPoint>[] = sampleWeekdaySeries.slice(0, 1);
