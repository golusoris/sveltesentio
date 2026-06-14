import { describe, it, expect } from 'vitest';
import {
	computeRows,
	initialTableState,
	setFilter,
	setPageIndex,
	setPageSize,
	toggleSort,
	type ColumnDef,
	type TableState,
} from '../src/data/model.js';

interface User {
	id: number;
	name: string;
	role: string;
	active: boolean;
}

const users: User[] = [
	{ id: 1, name: 'Charlie', role: 'admin', active: true },
	{ id: 2, name: 'alice', role: 'user', active: false },
	{ id: 3, name: 'Bob', role: 'user', active: true },
	{ id: 4, name: 'Dave', role: 'editor', active: false },
];

const columns: ColumnDef<User>[] = [
	{ id: 'name', header: 'Name', accessor: (u) => u.name },
	{ id: 'role', header: 'Role', accessor: (u) => u.role },
	{ id: 'id', header: 'ID', accessor: (u) => u.id },
	{ id: 'active', header: 'Active', accessor: (u) => u.active, filterable: false, sortable: false },
];

describe('toggleSort', () => {
	it('cycles none → asc → desc → none and resets page', () => {
		let s: TableState = { ...initialTableState, pageIndex: 3 };
		s = toggleSort(s, 'name');
		expect(s.sort).toEqual({ columnId: 'name', direction: 'asc' });
		expect(s.pageIndex).toBe(0);
		s = toggleSort(s, 'name');
		expect(s.sort).toEqual({ columnId: 'name', direction: 'desc' });
		s = toggleSort(s, 'name');
		expect(s.sort).toBeNull();
	});

	it('switching columns starts fresh at asc', () => {
		let s = toggleSort(initialTableState, 'name');
		s = toggleSort(s, 'role');
		expect(s.sort).toEqual({ columnId: 'role', direction: 'asc' });
	});
});

describe('computeRows — filter', () => {
	it('is case-insensitive substring across filterable columns', () => {
		const s = setFilter(initialTableState, 'USER');
		const view = computeRows(users, columns, s);
		expect(view.rows.map((u) => u.id).sort()).toEqual([2, 3]);
		expect(view.filteredCount).toBe(2);
	});

	it('skips columns marked filterable:false', () => {
		// "true" only appears in the active column, which is non-filterable.
		const view = computeRows(users, columns, setFilter(initialTableState, 'true'));
		expect(view.rows).toHaveLength(0);
	});

	it('empty filter returns all rows', () => {
		const view = computeRows(users, columns, initialTableState);
		expect(view.rows).toHaveLength(4);
	});
});

describe('computeRows — sort', () => {
	it('sorts strings case-insensitively ascending', () => {
		const s = toggleSort(initialTableState, 'name');
		const view = computeRows(users, columns, s);
		expect(view.rows.map((u) => u.name)).toEqual(['alice', 'Bob', 'Charlie', 'Dave']);
	});

	it('sorts numbers descending', () => {
		const s = toggleSort(toggleSort(initialTableState, 'id'), 'id');
		const view = computeRows(users, columns, s);
		expect(view.rows.map((u) => u.id)).toEqual([4, 3, 2, 1]);
	});

	it('ignores sort on a sortable:false column', () => {
		const s: TableState = { ...initialTableState, sort: { columnId: 'active', direction: 'asc' } };
		const view = computeRows(users, columns, s);
		// Unchanged source order.
		expect(view.rows.map((u) => u.id)).toEqual([1, 2, 3, 4]);
	});

	it('does not mutate the source array', () => {
		const before = users.map((u) => u.id);
		computeRows(users, columns, toggleSort(initialTableState, 'name'));
		expect(users.map((u) => u.id)).toEqual(before);
	});
});

describe('computeRows — pagination', () => {
	it('pageSize 0 returns all rows on one page', () => {
		const view = computeRows(users, columns, setPageSize(initialTableState, 0));
		expect(view.rows).toHaveLength(4);
		expect(view.pageCount).toBe(1);
	});

	it('slices to the requested page', () => {
		let s = setPageSize(initialTableState, 2);
		s = setPageIndex(s, 1);
		const view = computeRows(users, columns, s);
		expect(view.rows.map((u) => u.id)).toEqual([3, 4]);
		expect(view.pageCount).toBe(2);
		expect(view.pageIndex).toBe(1);
	});

	it('clamps an out-of-range page index to the last page', () => {
		let s = setPageSize(initialTableState, 2);
		s = setPageIndex(s, 99);
		const view = computeRows(users, columns, s);
		expect(view.pageIndex).toBe(1);
		expect(view.rows.map((u) => u.id)).toEqual([3, 4]);
	});

	it('setPageSize floors and clamps negatives to 0', () => {
		expect(setPageSize(initialTableState, -5).pageSize).toBe(0);
		expect(setPageSize(initialTableState, 2.9).pageSize).toBe(2);
	});

	it('combines filter + sort + paginate', () => {
		let s = setFilter(initialTableState, 'user'); // alice(2), Bob(3)
		s = toggleSort(s, 'name'); // asc → alice, Bob
		s = setPageSize(s, 1);
		s = setPageIndex(s, 1);
		const view = computeRows(users, columns, s);
		expect(view.filteredCount).toBe(2);
		expect(view.rows.map((u) => u.name)).toEqual(['Bob']);
	});
});
