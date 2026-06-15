import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ColumnDef } from '../src/data/model.js';
import type * as DataTableModule from '../src/data/createDataTable.svelte.js';

type DataTableStore<T> = DataTableModule.DataTableStore<T>;
type InitialState = DataTableModule.DataTableOptions<User>['initialState'];

/**
 * `createDataTable.svelte.ts` is a rune module: it holds source rows + view
 * state in `$state` and exposes `view` through a getter that re-runs the pure
 * `computeRows` model on every read. The monorepo runs vitest in `node` (no
 * Svelte compiler), so — mirroring collab/realtime's rune tests — we install a
 * minimal non-reactive shim on `globalThis`: `$state(v)` returns `v`, and we
 * add `$effect.root(fn)` so rune access can be wrapped in a root scope with
 * deterministic teardown. Reactivity is not asserted; the `view` getter is
 * pull-based, so reading it after each mutation observes the current state.
 *
 * The store wraps the model: single-column sort toggle (none → asc → desc →
 * none), a global substring filter, and page/pageSize pagination. The source
 * has no multi-sort and no row-selection API, so those are not exercised here
 * (see the pure-model coverage in data-model.test.ts).
 */

interface User {
	readonly id: number;
	readonly name: string;
	readonly role: string;
	readonly active: boolean;
}

const seed: readonly User[] = [
	{ id: 1, name: 'Charlie', role: 'admin', active: true },
	{ id: 2, name: 'alice', role: 'user', active: false },
	{ id: 3, name: 'Bob', role: 'user', active: true },
	{ id: 4, name: 'Dave', role: 'editor', active: false },
];

const columns: readonly ColumnDef<User>[] = [
	{ id: 'name', header: 'Name', accessor: (u) => u.name },
	{ id: 'role', header: 'Role', accessor: (u) => u.role },
	{ id: 'id', header: 'ID', accessor: (u) => u.id },
	{
		id: 'active',
		header: 'Active',
		accessor: (u) => u.active,
		filterable: false,
		sortable: false,
	},
];

const g = globalThis as unknown as { $state?: unknown; $effect?: unknown };
let dispose: (() => void) | undefined;

beforeEach(() => {
	g.$state = <T>(initial: T): T => initial;
	const effect = (fn: () => void | (() => void)): void => {
		fn();
	};
	(effect as { root?: unknown }).root = (fn: () => void | (() => void)): (() => void) => {
		const cleanup = fn();
		return typeof cleanup === 'function' ? cleanup : (): void => {};
	};
	g.$effect = effect;
});

afterEach(() => {
	dispose?.();
	dispose = undefined;
	delete g.$state;
	delete g.$effect;
});

/**
 * Build a store inside `$effect.root` and run `body` within the same scope, so
 * rune reads happen under a root and teardown fires in `afterEach`. The store
 * is returned for assertions that outlive the closure.
 */
function withStore(
	options: { readonly rows?: readonly User[]; readonly initialState?: InitialState },
	body: (store: DataTableStore<User>) => void,
): DataTableStore<User> {
	let store!: DataTableStore<User>;
	dispose = $effect.root(() => {
		store = createTable(options);
		body(store);
	});
	return store;
}

// Late-bound runtime bindings so the `$state` shim is installed (in the hook
// below) before the rune module loads.
let createTableStore!: typeof DataTableModule.createDataTable;
let StoreClass!: typeof DataTableModule.DataTableStore;

beforeEach(async () => {
	const mod = await import('../src/data/createDataTable.svelte.js');
	createTableStore = mod.createDataTable;
	StoreClass = mod.DataTableStore;
});

function createTable(options: {
	readonly rows?: readonly User[];
	readonly initialState?: InitialState;
}): DataTableStore<User> {
	return createTableStore<User>({
		rows: options.rows ?? seed,
		columns,
		...(options.initialState ? { initialState: options.initialState } : {}),
	});
}

describe('createDataTable — construction & state', () => {
	it('exposes the supplied columns verbatim', () => {
		withStore({}, (t) => {
			expect(t.columns).toBe(columns);
		});
	});

	it('defaults to the initial table state (no sort, no filter, no paging)', () => {
		withStore({}, (t) => {
			expect(t.state).toEqual({ sort: null, filter: '', pageIndex: 0, pageSize: 0 });
		});
	});

	it('merges a partial initialState over the defaults', () => {
		withStore({ initialState: { pageSize: 2, filter: 'user' } }, (t) => {
			expect(t.state.pageSize).toBe(2);
			expect(t.state.filter).toBe('user');
			expect(t.state.pageIndex).toBe(0);
			expect(t.state.sort).toBeNull();
		});
	});

	it('renders all source rows in source order with no view state', () => {
		withStore({}, (t) => {
			expect(t.view.rows.map((u) => u.id)).toEqual([1, 2, 3, 4]);
			expect(t.view.filteredCount).toBe(4);
			expect(t.view.pageCount).toBe(1);
			expect(t.view.pageIndex).toBe(0);
		});
	});

	it('the factory and the class produce equivalent stores', () => {
		dispose = $effect.root(() => {
			const viaFactory = createTableStore<User>({ rows: seed, columns });
			const viaClass = new StoreClass<User>({ rows: seed, columns });
			expect(viaFactory).toBeInstanceOf(StoreClass);
			expect(viaFactory.view.rows.map((u) => u.id)).toEqual(viaClass.view.rows.map((u) => u.id));
		});
	});
});

describe('createDataTable — column sort toggle', () => {
	it('cycles a column none → asc → desc → none', () => {
		withStore({}, (t) => {
			t.toggleSort('name');
			expect(t.state.sort).toEqual({ columnId: 'name', direction: 'asc' });
			expect(t.view.rows.map((u) => u.name)).toEqual(['alice', 'Bob', 'Charlie', 'Dave']);

			t.toggleSort('name');
			expect(t.state.sort).toEqual({ columnId: 'name', direction: 'desc' });
			expect(t.view.rows.map((u) => u.name)).toEqual(['Dave', 'Charlie', 'Bob', 'alice']);

			t.toggleSort('name');
			expect(t.state.sort).toBeNull();
			expect(t.view.rows.map((u) => u.id)).toEqual([1, 2, 3, 4]);
		});
	});

	it('switching to a different column restarts at ascending', () => {
		withStore({}, (t) => {
			t.toggleSort('name');
			t.toggleSort('name'); // name desc
			t.toggleSort('role'); // switch → role asc
			expect(t.state.sort).toEqual({ columnId: 'role', direction: 'asc' });
			expect(t.view.rows.map((u) => u.role)).toEqual(['admin', 'editor', 'user', 'user']);
		});
	});

	it('sorts numeric columns numerically, not lexicographically', () => {
		const many: readonly User[] = [
			{ id: 10, name: 'j', role: 'x', active: true },
			{ id: 2, name: 'b', role: 'x', active: true },
			{ id: 1, name: 'a', role: 'x', active: true },
		];
		withStore({ rows: many }, (t) => {
			t.toggleSort('id');
			expect(t.view.rows.map((u) => u.id)).toEqual([1, 2, 10]);
		});
	});

	it('ignores sort requests against a sortable:false column', () => {
		withStore({}, (t) => {
			t.toggleSort('active');
			// State records the request, but the view keeps source order.
			expect(t.state.sort).toEqual({ columnId: 'active', direction: 'asc' });
			expect(t.view.rows.map((u) => u.id)).toEqual([1, 2, 3, 4]);
		});
	});

	it('resets pageIndex to 0 when a sort toggles', () => {
		withStore({ initialState: { pageSize: 2, pageIndex: 1 } }, (t) => {
			expect(t.state.pageIndex).toBe(1);
			t.toggleSort('name');
			expect(t.state.pageIndex).toBe(0);
		});
	});

	it('does not mutate the source rows while sorting', () => {
		const rows: readonly User[] = seed.map((u) => ({ ...u }));
		const before = rows.map((u) => u.id);
		withStore({ rows }, (t) => {
			t.toggleSort('name');
			void t.view.rows;
		});
		expect(rows.map((u) => u.id)).toEqual(before);
	});
});

describe('createDataTable — filter predicate', () => {
	it('applies a case-insensitive substring filter across filterable columns', () => {
		withStore({}, (t) => {
			t.setFilter('USER');
			expect(t.view.rows.map((u) => u.id).sort((a, b) => a - b)).toEqual([2, 3]);
			expect(t.view.filteredCount).toBe(2);
		});
	});

	it('skips non-filterable columns', () => {
		withStore({}, (t) => {
			// "true" only stringifies from the non-filterable `active` column.
			t.setFilter('true');
			expect(t.view.rows).toHaveLength(0);
			expect(t.view.filteredCount).toBe(0);
		});
	});

	it('trims whitespace-only filters to an all-rows result', () => {
		withStore({}, (t) => {
			t.setFilter('   ');
			expect(t.view.rows).toHaveLength(4);
		});
	});

	it('clearing the filter restores the full set', () => {
		withStore({}, (t) => {
			t.setFilter('alice');
			expect(t.view.rows).toHaveLength(1);
			t.setFilter('');
			expect(t.view.rows).toHaveLength(4);
		});
	});

	it('resets pageIndex to 0 when the filter changes', () => {
		withStore({ initialState: { pageSize: 1, pageIndex: 2 } }, (t) => {
			t.setFilter('user');
			expect(t.state.pageIndex).toBe(0);
		});
	});
});

describe('createDataTable — pagination', () => {
	it('derives pageCount and pageIndex from pageSize + total', () => {
		withStore({ initialState: { pageSize: 2 } }, (t) => {
			expect(t.view.pageCount).toBe(2);
			expect(t.view.pageIndex).toBe(0);
			expect(t.view.rows.map((u) => u.id)).toEqual([1, 2]);
		});
	});

	it('slices to the requested page', () => {
		withStore({ initialState: { pageSize: 2 } }, (t) => {
			t.setPageIndex(1);
			expect(t.view.rows.map((u) => u.id)).toEqual([3, 4]);
			expect(t.view.pageIndex).toBe(1);
		});
	});

	it('clamps an out-of-range page index to the last page', () => {
		withStore({ initialState: { pageSize: 2 } }, (t) => {
			t.setPageIndex(99);
			expect(t.view.pageIndex).toBe(1);
			expect(t.view.rows.map((u) => u.id)).toEqual([3, 4]);
		});
	});

	it('clamps a negative page index to 0', () => {
		withStore({ initialState: { pageSize: 2 } }, (t) => {
			t.setPageIndex(-3);
			expect(t.state.pageIndex).toBe(0);
			expect(t.view.rows.map((u) => u.id)).toEqual([1, 2]);
		});
	});

	it('floors and clamps the page size, resetting to page 0', () => {
		withStore({ initialState: { pageSize: 2, pageIndex: 1 } }, (t) => {
			t.setPageSize(3.9);
			expect(t.state.pageSize).toBe(3);
			expect(t.state.pageIndex).toBe(0);

			t.setPageSize(-10);
			expect(t.state.pageSize).toBe(0);
			// pageSize 0 disables pagination: one page holds everything.
			expect(t.view.pageCount).toBe(1);
			expect(t.view.rows).toHaveLength(4);
		});
	});

	it('reports a single page when pagination is disabled (pageSize 0)', () => {
		withStore({}, (t) => {
			expect(t.view.pageCount).toBe(1);
			expect(t.view.pageIndex).toBe(0);
			expect(t.view.rows).toHaveLength(4);
		});
	});
});

describe('createDataTable — setRows', () => {
	it('recomputes the view from a replaced source set', () => {
		withStore({}, (t) => {
			expect(t.view.rows).toHaveLength(4);
			t.setRows([{ id: 99, name: 'Zed', role: 'guest', active: true }]);
			expect(t.view.rows.map((u) => u.id)).toEqual([99]);
			expect(t.view.filteredCount).toBe(1);
		});
	});

	it('reapplies the active filter + sort to the new rows', () => {
		withStore({ initialState: { filter: 'user' } }, (t) => {
			t.toggleSort('name'); // asc
			t.setRows([
				{ id: 5, name: 'Yvonne', role: 'user', active: true },
				{ id: 6, name: 'admin-only', role: 'admin', active: true },
				{ id: 7, name: 'Xena', role: 'user', active: false },
			]);
			// Filter "user" keeps ids 5 & 7; ascending name sort → Xena, Yvonne.
			expect(t.view.rows.map((u) => u.name)).toEqual(['Xena', 'Yvonne']);
			expect(t.view.filteredCount).toBe(2);
		});
	});

	it('emptying the source yields an empty view with one page', () => {
		withStore({ initialState: { pageSize: 2 } }, (t) => {
			t.setRows([]);
			expect(t.view.rows).toHaveLength(0);
			expect(t.view.filteredCount).toBe(0);
			expect(t.view.pageCount).toBe(1);
			expect(t.view.pageIndex).toBe(0);
		});
	});
});

describe('createDataTable — combined derived output', () => {
	it('reflects filter + sort + pagination together in one view', () => {
		withStore({}, (t) => {
			t.setFilter('user'); // alice(2), Bob(3)
			t.toggleSort('name'); // asc → alice, Bob
			t.setPageSize(1);
			t.setPageIndex(1);
			const view = t.view;
			expect(view.filteredCount).toBe(2);
			expect(view.pageCount).toBe(2);
			expect(view.pageIndex).toBe(1);
			expect(view.rows.map((u) => u.name)).toEqual(['Bob']);
		});
	});

	it('a later mutation supersedes earlier view state', () => {
		withStore({}, (t) => {
			t.setFilter('user');
			expect(t.view.filteredCount).toBe(2);
			// Widening the filter to everyone changes the derived output.
			t.setFilter('');
			expect(t.view.filteredCount).toBe(4);
			expect(t.view.rows.map((u) => u.id)).toEqual([1, 2, 3, 4]);
		});
	});

	it('clamps the page when a filter shrinks the result below the current page', () => {
		withStore({ initialState: { pageSize: 2 } }, (t) => {
			t.setPageIndex(1); // last page of 4 rows
			expect(t.view.rows.map((u) => u.id)).toEqual([3, 4]);
			// Filtering to a single row forces the view back onto the only page.
			t.setFilter('alice');
			expect(t.view.filteredCount).toBe(1);
			expect(t.view.pageCount).toBe(1);
			expect(t.view.pageIndex).toBe(0);
			expect(t.view.rows.map((u) => u.id)).toEqual([2]);
		});
	});
});
