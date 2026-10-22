// Row types the test harnesses render. The harnesses take these concrete types
// rather than a `generics` parameter: svelte-check types a `render(Harness, …)`
// call against the harness's own props, and a generic harness erases to
// `unknown` there, while plain tsc sees every .svelte import as untyped.

import type { ChartSeries, ChartAccessors, BuildTableOptions } from '../src/a11y-table.js';

/** One point of a cartesian series: `t` is the x category, `v` the y value. */
export interface Point {
	t: string;
	v: number | null;
}

/** One pie slice. */
export interface Slice {
	name: string;
	count: number;
}

/** Shared props for the test Chart / ChartFigure harness. */
export interface ChartHarnessProps {
	as?: 'figure' | 'chart' | undefined;
	title: string;
	description?: string | undefined;
	series: readonly ChartSeries<Point>[];
	accessors: ChartAccessors<Point>;
	tableOptions?: BuildTableOptions<Point> | undefined;
	showDataTable?: boolean | undefined;
	idBase?: string | undefined;
}
