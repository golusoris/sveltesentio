import axe from 'axe-core';
import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import CartesianHarness from './CartesianChartHarness.svelte';
import PieHarness from './PieChartHarness.svelte';
import ChartHarness from './ChartHarness.svelte';
import type { CartesianSeries } from '../src/chart-series.js';
import type { ChartAccessors, ChartSeries } from '../src/a11y-table.js';

interface Point {
	t: string;
	v: number | null;
}

const accessors: ChartAccessors<Point> = { x: (d) => d.t, y: (d) => d.v };

const series: CartesianSeries<Point>[] = [
	{
		key: 'sessions',
		label: 'Sessions',
		data: [
			{ t: 'Mon', v: 1000 },
			{ t: 'Tue', v: 2500 },
		],
	},
	{
		key: 'errors',
		label: 'Errors',
		data: [
			{ t: 'Mon', v: 12 },
			{ t: 'Tue', v: 7 },
		],
	},
];

interface Slice {
	name: string;
	count: number;
}

const slices: Slice[] = [
	{ name: 'Chrome', count: 60 },
	{ name: 'Firefox', count: 30 },
	{ name: 'Safari', count: 10 },
];

// WCAG 2.2 AA tag set (mirrors @sveltesentio/testing's axeDefaults / ADR-0031).
const WCAG_22_AA_TAGS = [
	'wcag2a',
	'wcag2aa',
	'wcag21a',
	'wcag21aa',
	'wcag22aa',
	'best-practice',
];

async function expectNoAxeViolations(container: HTMLElement): Promise<void> {
	const results = await axe.run(container, {
		runOnly: { type: 'tag', values: WCAG_22_AA_TAGS },
		resultTypes: ['violations'],
	});
	const serious = results.violations.filter(
		(v) => v.impact === 'serious' || v.impact === 'critical',
	);
	expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
}

const CARTESIAN_KINDS = ['line', 'area', 'bar', 'scatter'] as const;

describe.each(CARTESIAN_KINDS)('%s chart wrapper', (kind) => {
	function renderChart(
		props: {
			title?: string;
			description?: string;
			series?: readonly CartesianSeries<Point>[];
			showDataTable?: boolean;
			tableOptions?: { xLabel?: string };
		} = {},
	) {
		return render(CartesianHarness, {
			kind,
			title: props.title ?? 'Daily sessions',
			description: props.description,
			series: props.series ?? series,
			accessors,
			showDataTable: props.showDataTable,
			tableOptions: props.tableOptions,
		});
	}

	it('wraps the visual in a <figure> with a titled <figcaption>', () => {
		const { container } = renderChart();
		expect(container.querySelector('figure')).toBeInTheDocument();
		expect(container.querySelector('figcaption')).toHaveTextContent('Daily sessions');
	});

	it('exposes the chart region as role="img" labelled by the caption', () => {
		const { getByRole, container } = renderChart();
		const img = getByRole('img');
		const caption = container.querySelector('figcaption');
		expect(img.getAttribute('aria-labelledby')).toBe(caption?.id);
	});

	it('builds the SR data table from the same series + accessors', () => {
		const { getAllByRole } = renderChart();
		// x-axis column + one column per series.
		const colHeaders = getAllByRole('columnheader');
		expect(colHeaders.map((h) => h.textContent)).toEqual([
			'Category',
			'Sessions',
			'Errors',
		]);
		// Row per x value, first-seen order.
		const rowHeaders = getAllByRole('rowheader');
		expect(rowHeaders.map((h) => h.textContent)).toEqual(['Mon', 'Tue']);
	});

	it('honours a custom xLabel and suppresses the table when asked', () => {
		const labelled = renderChart({ tableOptions: { xLabel: 'Day' } });
		expect(labelled.getAllByRole('columnheader')[0]).toHaveTextContent('Day');
		labelled.unmount();

		const suppressed = renderChart({ showDataTable: false });
		expect(suppressed.queryByRole('table')).toBeNull();
		expect(suppressed.getByRole('img')).toBeInTheDocument();
	});

	it('wires aria-describedby when a description is supplied', () => {
		const { getByRole, container } = renderChart({
			description: 'Sessions and errors per weekday.',
		});
		const desc = container.querySelector('p.ssentio-chart-figure__desc');
		expect(desc).toHaveTextContent('Sessions and errors per weekday.');
		expect(getByRole('img').getAttribute('aria-describedby')).toBe(desc?.id);
	});

	it('renders without the table for an empty series set', () => {
		const { getByRole } = renderChart({ series: [] });
		expect(getByRole('img')).toBeInTheDocument();
	});

	it('is axe-clean (WCAG 2.2 AA) with a description + data table', async () => {
		const { container } = renderChart({
			description: 'Sessions and errors per weekday.',
		});
		await expectNoAxeViolations(container);
	});
});

describe('pie chart wrapper', () => {
	function renderPie(
		props: {
			title?: string;
			description?: string;
			valueLabel?: string;
			showDataTable?: boolean;
		} = {},
	) {
		return render(PieHarness, {
			title: props.title ?? 'Browser share',
			description: props.description,
			data: slices,
			key: (d: Slice) => d.name,
			value: (d: Slice) => d.count,
			valueLabel: props.valueLabel,
			showDataTable: props.showDataTable,
		});
	}

	it('wraps the pie in a <figure> with the title', () => {
		const { container } = renderPie();
		expect(container.querySelector('figure')).toBeInTheDocument();
		expect(container.querySelector('figcaption')).toHaveTextContent('Browser share');
	});

	it('lists one SR row per slice with the category + value', () => {
		const { getAllByRole } = renderPie({ valueLabel: 'Share' });
		const colHeaders = getAllByRole('columnheader');
		expect(colHeaders.map((h) => h.textContent)).toEqual(['Category', 'Share']);

		const rowHeaders = getAllByRole('rowheader');
		expect(rowHeaders.map((h) => h.textContent)).toEqual([
			'Chrome',
			'Firefox',
			'Safari',
		]);

		const cells = getAllByRole('cell');
		expect(cells.map((c) => c.textContent)).toEqual([
			new Intl.NumberFormat().format(60),
			new Intl.NumberFormat().format(30),
			new Intl.NumberFormat().format(10),
		]);
	});

	it('defaults the value column label to "Value"', () => {
		const { getAllByRole } = renderPie();
		expect(getAllByRole('columnheader')[1]).toHaveTextContent('Value');
	});

	it('suppresses the table when showDataTable is false', () => {
		const { queryByRole, getByRole } = renderPie({ showDataTable: false });
		expect(queryByRole('table')).toBeNull();
		expect(getByRole('img')).toBeInTheDocument();
	});

	it('is axe-clean (WCAG 2.2 AA)', async () => {
		const { container } = renderPie({ description: 'Share of sessions by browser.' });
		await expectNoAxeViolations(container);
	});
});

describe('low-level Chart wrapper', () => {
	const figureSeries: ChartSeries<Point>[] = [
		{ key: 'sessions', label: 'Sessions', data: [{ t: 'Mon', v: 1000 }] },
	];

	function renderLowLevel(
		props: { description?: string; showDataTable?: boolean } = {},
	) {
		return render(ChartHarness, {
			title: 'Custom composition',
			description: props.description,
			series: figureSeries,
			accessors,
			showDataTable: props.showDataTable,
		});
	}

	it('renders the caller-supplied chart snippet inside role="img"', () => {
		const { getByTestId, getByRole } = renderLowLevel();
		const viz = getByTestId('custom-viz');
		expect(viz).toHaveTextContent('custom composition');
		expect(getByRole('img')).toContainElement(viz);
	});

	it('still emits the SR data table from the passed series', () => {
		const { getAllByRole } = renderLowLevel();
		expect(getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
			'Category',
			'Sessions',
		]);
	});

	it('suppresses the data table when asked', () => {
		const { queryByRole, getByRole } = renderLowLevel({ showDataTable: false });
		expect(queryByRole('table')).toBeNull();
		expect(getByRole('img')).toBeInTheDocument();
	});

	it('is axe-clean (WCAG 2.2 AA)', async () => {
		const { container } = renderLowLevel({ description: 'A bespoke layered chart.' });
		await expectNoAxeViolations(container);
	});
});
