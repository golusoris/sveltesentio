import axe from 'axe-core';
import { render, fireEvent } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Harness from './ChartFigureHarness.svelte';
import type { ChartAccessors, ChartSeries } from '../src/a11y-table.js';

interface Point {
	t: string;
	v: number | null;
}

const accessors: ChartAccessors<Point> = {
	x: (d) => d.t,
	y: (d) => d.v,
};

const series: ChartSeries<Point>[] = [
	{
		key: 'sessions',
		label: 'Sessions',
		data: [
			{ t: 'Mon', v: 1000 },
			{ t: 'Tue', v: 2500 },
		],
	},
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

function renderFigure(props: Partial<Parameters<typeof renderProps>[0]> = {}) {
	return render(Harness, renderProps(props));
}

function renderProps(props: {
	title?: string;
	description?: string;
	series?: readonly ChartSeries<Point>[];
	accessors?: ChartAccessors<Point>;
	showDataTable?: boolean;
	idBase?: string;
	tableOptions?: { xLabel?: string };
}) {
	return {
		title: props.title ?? 'Daily sessions',
		description: props.description,
		series: props.series ?? series,
		accessors: props.accessors ?? accessors,
		showDataTable: props.showDataTable,
		idBase: props.idBase,
		tableOptions: props.tableOptions,
	};
}

describe('ChartFigure', () => {
	it('renders a <figure> with a <figcaption> holding the title', () => {
		const { container } = renderFigure({ title: 'Daily sessions' });

		const figure = container.querySelector('figure');
		expect(figure).toBeInTheDocument();

		const caption = container.querySelector('figcaption');
		expect(caption).toBeInTheDocument();
		expect(caption).toHaveTextContent('Daily sessions');
	});

	it('names the figure via aria-labelledby pointing at the caption id', () => {
		const { container } = renderFigure({ title: 'Daily sessions' });

		const figure = container.querySelector('figure');
		const caption = container.querySelector('figcaption');
		const labelledby = figure?.getAttribute('aria-labelledby');

		expect(labelledby).toBeTruthy();
		expect(caption?.id).toBe(labelledby);
	});

	it('exposes the visual region as role="img" labelled by the title', () => {
		const { getByRole, container } = renderFigure({ title: 'Daily sessions' });

		const img = getByRole('img');
		expect(img).toBeInTheDocument();

		const caption = container.querySelector('figcaption');
		expect(img.getAttribute('aria-labelledby')).toBe(caption?.id);
	});

	it('renders the slotted chart content inside the visual region', () => {
		const { getByTestId, getByRole } = renderFigure();

		const viz = getByTestId('viz-content');
		expect(viz).toBeInTheDocument();
		expect(viz).toHaveTextContent('rendered visual');
		expect(getByRole('img')).toContainElement(viz);
	});

	it('wires aria-describedby to the description paragraph when provided', () => {
		const { container, getByRole } = renderFigure({
			description: 'Sessions per weekday for the current period.',
		});

		const desc = container.querySelector('p.ssentio-chart-figure__desc');
		expect(desc).toBeInTheDocument();
		expect(desc).toHaveTextContent('Sessions per weekday for the current period.');

		const img = getByRole('img');
		expect(img.getAttribute('aria-describedby')).toBe(desc?.id);
	});

	it('omits aria-describedby and the description paragraph when no description', () => {
		const { container, getByRole } = renderFigure();

		expect(container.querySelector('p.ssentio-chart-figure__desc')).toBeNull();
		expect(getByRole('img').hasAttribute('aria-describedby')).toBe(false);
	});

	it('renders the screen-reader data table from the series model by default', () => {
		const { getByRole, getAllByRole } = renderFigure();

		const table = getByRole('table');
		expect(table).toBeInTheDocument();

		// Column headers: x-axis label + one per series.
		const colHeaders = getAllByRole('columnheader');
		expect(colHeaders.map((h) => h.textContent)).toEqual(['Category', 'Sessions']);

		// Row headers come from the x accessor, in first-seen order.
		const rowHeaders = getAllByRole('rowheader');
		expect(rowHeaders.map((h) => h.textContent)).toEqual(['Mon', 'Tue']);

		// Cells carry the formatted y values.
		const cells = getAllByRole('cell');
		expect(cells.map((c) => c.textContent)).toEqual([
			new Intl.NumberFormat().format(1000),
			new Intl.NumberFormat().format(2500),
		]);
	});

	it('honours a custom xLabel in the data-table header', () => {
		const { getAllByRole } = renderFigure({ tableOptions: { xLabel: 'Day' } });
		const colHeaders = getAllByRole('columnheader');
		expect(colHeaders[0]).toHaveTextContent('Day');
	});

	it('suppresses the data table when showDataTable is false', () => {
		const { queryByRole, getByRole } = renderFigure({ showDataTable: false });

		expect(queryByRole('table')).toBeNull();
		// The visual region must still be present.
		expect(getByRole('img')).toBeInTheDocument();
	});

	it('derives stable aria ids from the title and keeps them associated', () => {
		const { container } = renderFigure({ title: 'Weekly Active Users' });

		const caption = container.querySelector('figcaption');
		const figure = container.querySelector('figure');
		// Runs of non-word chars collapse to a single hyphen, lower-cased.
		expect(caption?.id).toBe('chart-weekly-active-users-title');
		expect(figure?.getAttribute('aria-labelledby')).toBe(caption?.id);
	});

	it('slugifies trailing punctuation in the title into the derived id', () => {
		const { container } = renderFigure({ title: 'Errors (5xx)!' });
		// `(` `5xx` `)!` → the trailing `)!` becomes one hyphen before `-title`.
		const caption = container.querySelector('figcaption');
		expect(caption?.id).toBe('chart-errors-5xx--title');
	});

	it('uses an explicit idBase for aria wiring when supplied', () => {
		const { container } = renderFigure({ idBase: 'kpi-7' });
		const caption = container.querySelector('figcaption');
		expect(caption?.id).toBe('kpi-7-title');
	});

	it('updates the caption and aria wiring when the title prop changes', async () => {
		const { container, rerender } = renderFigure({ title: 'Daily sessions' });

		await rerender(renderProps({ title: 'Monthly sessions' }));

		const caption = container.querySelector('figcaption');
		const figure = container.querySelector('figure');
		expect(caption).toHaveTextContent('Monthly sessions');
		expect(caption?.id).toBe('chart-monthly-sessions-title');
		expect(figure?.getAttribute('aria-labelledby')).toBe(caption?.id);
	});

	it('keeps the data table reachable after a focus interaction on the figure', async () => {
		const { getByRole } = renderFigure();
		const img = getByRole('img');

		// role="img" is non-interactive; firing a focus event must not throw and
		// must leave the accessible structure intact (no JS-driven teardown).
		await fireEvent.focus(img);
		expect(getByRole('table')).toBeInTheDocument();
	});

	it('is axe-clean (WCAG 2.2 AA) with a description and data table', async () => {
		const { container } = renderFigure({
			description: 'Sessions per weekday for the current period.',
		});
		await expectNoAxeViolations(container);
	});

	it('is axe-clean when the data table is suppressed', async () => {
		const { container } = renderFigure({ showDataTable: false });
		await expectNoAxeViolations(container);
	});
});
