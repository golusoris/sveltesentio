// Component-render tests for DataTable.svelte: WCAG 2.2 AA grid semantics +
// header-sort interaction (ADR-0011/0024). The component is a thin view over the
// pure `computeRows` model; here we mount it and drive the ARIA + sort behaviour
// through the real DOM (click + keyboard).
import { fireEvent, render, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import DataTable from '../src/data/DataTable.svelte';
import type { ColumnDef } from '../src/data/model.js';
import { expectNoAxeViolations } from './axe-helper.js';

interface Person {
	id: number;
	name: string;
	age: number;
}

const rows: readonly Person[] = [
	{ id: 1, name: 'Charlie', age: 30 },
	{ id: 2, name: 'Alice', age: 41 },
	{ id: 3, name: 'Bob', age: 22 },
];

const columns: readonly ColumnDef<Person>[] = [
	{ id: 'name', header: 'Name', accessor: (r) => r.name },
	{ id: 'age', header: 'Age', accessor: (r) => r.age },
	{ id: 'id', header: 'ID', accessor: (r) => r.id, sortable: false },
];

function renderTable() {
	return render(DataTable<Person>, {
		rows,
		columns,
		label: 'People',
		rowKey: (r: Person) => r.id,
	});
}

/** Cell text for the `name` column (col 1) across body rows, in render order. */
function nameColumn(grid: HTMLElement): string[] {
	const bodyRows = within(grid)
		.getAllByRole('row')
		.filter((row) => within(row).queryAllByRole('columnheader').length === 0);
	return bodyRows.map((row) => within(row).getAllByRole('gridcell')[0]?.textContent ?? '');
}

describe('<DataTable>', () => {
	it('exposes a labelled grid with the full dataset rowcount + colcount', () => {
		const { getByRole } = renderTable();

		const grid = getByRole('grid', { name: 'People' });
		expect(grid).toBeInTheDocument();
		// aria-rowcount = data rows + 1 header row; aria-colcount = column count.
		expect(grid).toHaveAttribute('aria-rowcount', String(rows.length + 1));
		expect(grid).toHaveAttribute('aria-colcount', String(columns.length));
	});

	it('renders a column header per column with header text', () => {
		const { getAllByRole } = renderTable();
		const headers = getAllByRole('columnheader');
		expect(headers.map((h) => h.textContent?.trim())).toEqual(['Name', 'Age', 'ID']);
	});

	it('renders one gridcell per column for every data row', () => {
		const { getByRole } = renderTable();
		const grid = getByRole('grid');
		expect(within(grid).getAllByRole('gridcell')).toHaveLength(rows.length * columns.length);
		expect(nameColumn(grid)).toEqual(['Charlie', 'Alice', 'Bob']);
	});

	it('marks sortable headers aria-sort=none initially and makes them focusable', () => {
		const { getByRole } = renderTable();

		const name = getByRole('columnheader', { name: 'Name' });
		expect(name).toHaveAttribute('aria-sort', 'none');
		expect(name).toHaveAttribute('tabindex', '0');

		// A non-sortable column carries neither aria-sort nor tabindex.
		const id = getByRole('columnheader', { name: 'ID' });
		expect(id).not.toHaveAttribute('aria-sort');
		expect(id).not.toHaveAttribute('tabindex');
	});

	it('sorts ascending on header click and reflects aria-sort=ascending', async () => {
		const { getByRole } = renderTable();
		const grid = getByRole('grid');
		const name = within(grid).getByRole('columnheader', { name: 'Name' });

		await fireEvent.click(name);

		expect(name).toHaveAttribute('aria-sort', 'ascending');
		expect(nameColumn(grid)).toEqual(['Alice', 'Bob', 'Charlie']);
	});

	it('cycles none -> ascending -> descending -> none across repeated clicks', async () => {
		const { getByRole } = renderTable();
		const grid = getByRole('grid');
		const name = within(grid).getByRole('columnheader', { name: 'Name' });

		await fireEvent.click(name);
		expect(name).toHaveAttribute('aria-sort', 'ascending');

		await fireEvent.click(name);
		expect(name).toHaveAttribute('aria-sort', 'descending');
		expect(nameColumn(grid)).toEqual(['Charlie', 'Bob', 'Alice']);

		await fireEvent.click(name);
		expect(name).toHaveAttribute('aria-sort', 'none');
		expect(nameColumn(grid)).toEqual(['Charlie', 'Alice', 'Bob']);
	});

	it('sorts via the Enter key on a focused header', async () => {
		const { getByRole } = renderTable();
		const grid = getByRole('grid');
		const age = within(grid).getByRole('columnheader', { name: 'Age' });

		await fireEvent.keyDown(age, { key: 'Enter' });

		expect(age).toHaveAttribute('aria-sort', 'ascending');
		// Ages 30/41/22 ascending -> rows Bob(22), Charlie(30), Alice(41).
		expect(nameColumn(grid)).toEqual(['Bob', 'Charlie', 'Alice']);
	});

	it('sorts via the Space key on a focused header', async () => {
		const { getByRole } = renderTable();
		const grid = getByRole('grid');
		const name = within(grid).getByRole('columnheader', { name: 'Name' });

		await fireEvent.keyDown(name, { key: ' ' });
		expect(name).toHaveAttribute('aria-sort', 'ascending');
	});

	it('does not sort when a non-sortable header is activated', async () => {
		const { getByRole } = renderTable();
		const grid = getByRole('grid');
		const id = within(grid).getByRole('columnheader', { name: 'ID' });

		await fireEvent.click(id);
		// Order unchanged; no aria-sort appears on the non-sortable column.
		expect(nameColumn(grid)).toEqual(['Charlie', 'Alice', 'Bob']);
		expect(id).not.toHaveAttribute('aria-sort');
	});

	it('is axe-clean in the default (unsorted) state', async () => {
		const { container } = renderTable();
		await expectNoAxeViolations(container);
	});

	it('is axe-clean after sorting a column', async () => {
		const { container, getByRole } = renderTable();
		await fireEvent.click(getByRole('columnheader', { name: 'Name' }));
		await expectNoAxeViolations(container);
	});
});
