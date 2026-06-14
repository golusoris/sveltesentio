/**
 * Headless `DataTable<T>` model (ADR-0011). Column defs + pure state reducers
 * for sort / filter / paginate, modeled on Lurkarr's generic table. No Svelte,
 * no DOM — the `.svelte` component is a thin consumer of this state. Kept
 * unopinionated (ADR-0011 consequence: arca hand-rolls when wrappers over-reach).
 */

/** Accessor + presentation metadata for one column of `T`. */
export interface ColumnDef<T> {
	/** Stable column id (also the `aria-colindex` anchor). */
	readonly id: string;
	/** Human label for the header cell. */
	readonly header: string;
	/** Pull the cell value out of a row. */
	readonly accessor: (row: T) => unknown;
	/** Whether the column participates in sorting. Default `true`. */
	readonly sortable?: boolean;
	/** Whether the column is searched by the global filter. Default `true`. */
	readonly filterable?: boolean;
}

/** Stable row-key accessor used by `{#each}` keying in the table component. */
export type RowKey<T> = (row: T, index: number) => string | number;

export type SortDirection = 'asc' | 'desc';

export interface SortState {
	readonly columnId: string;
	readonly direction: SortDirection;
}

/** Immutable view state driving the table. */
export interface TableState {
	/** Active sort, or `null` for source order. */
	readonly sort: SortState | null;
	/** Global full-text filter (case-insensitive substring). */
	readonly filter: string;
	/** Current 0-based page index. */
	readonly pageIndex: number;
	/** Rows per page; `0` disables pagination (all rows on page 0). */
	readonly pageSize: number;
}

export const initialTableState: TableState = {
	sort: null,
	filter: '',
	pageIndex: 0,
	pageSize: 0,
};

/** Result of {@link computeRows}: the visible page plus pagination metadata. */
export interface TableView<T> {
	/** Rows after filter + sort + pagination. */
	readonly rows: readonly T[];
	/** Row count after filter + sort, before pagination. */
	readonly filteredCount: number;
	/** Total page count (≥ 1). */
	readonly pageCount: number;
	/** Clamped, effective page index. */
	readonly pageIndex: number;
}

/** Coerce an unknown cell value to a comparable/searchable string. */
function stringify(value: unknown): string {
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
		return String(value);
	}
	if (value instanceof Date) return value.toISOString();
	try {
		return JSON.stringify(value) ?? '';
	} catch {
		return '';
	}
}

function compareValues(a: unknown, b: unknown): number {
	if (a === b) return 0;
	if (a == null) return -1;
	if (b == null) return 1;
	if (typeof a === 'number' && typeof b === 'number') return a - b;
	if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
	return stringify(a).localeCompare(stringify(b), undefined, {
		numeric: true,
		sensitivity: 'base',
	});
}

/** Toggle sort for a column: none → asc → desc → none. Pure. */
export function toggleSort(state: TableState, columnId: string): TableState {
	const current = state.sort;
	let next: SortState | null;
	if (!current || current.columnId !== columnId) {
		next = { columnId, direction: 'asc' };
	} else if (current.direction === 'asc') {
		next = { columnId, direction: 'desc' };
	} else {
		next = null;
	}
	// Sorting resets to the first page so the user sees the new top rows.
	return { ...state, sort: next, pageIndex: 0 };
}

/** Set the global filter, resetting to the first page. Pure. */
export function setFilter(state: TableState, filter: string): TableState {
	return { ...state, filter, pageIndex: 0 };
}

/** Change the page size, clamping the current page into range. Pure. */
export function setPageSize(state: TableState, pageSize: number): TableState {
	const size = Math.max(0, Math.floor(pageSize));
	return { ...state, pageSize: size, pageIndex: 0 };
}

/** Move to a specific page (clamped ≥ 0). Pure. */
export function setPageIndex(state: TableState, pageIndex: number): TableState {
	return { ...state, pageIndex: Math.max(0, Math.floor(pageIndex)) };
}

function matchesFilter<T>(row: T, columns: readonly ColumnDef<T>[], needle: string): boolean {
	for (const col of columns) {
		if (col.filterable === false) continue;
		const value = col.accessor(row);
		if (value == null) continue;
		if (stringify(value).toLowerCase().includes(needle)) return true;
	}
	return false;
}

/**
 * Derive the visible page from source rows + column defs + state. Pure: applies
 * filter, then sort, then pagination, and reports counts for ARIA wiring.
 */
export function computeRows<T>(
	rows: readonly T[],
	columns: readonly ColumnDef<T>[],
	state: TableState,
): TableView<T> {
	const needle = state.filter.trim().toLowerCase();
	const filtered =
		needle === '' ? rows.slice() : rows.filter((row) => matchesFilter(row, columns, needle));

	if (state.sort) {
		const { columnId, direction } = state.sort;
		const column = columns.find((c) => c.id === columnId);
		if (column && column.sortable !== false) {
			const sign = direction === 'asc' ? 1 : -1;
			filtered.sort((a, b) => sign * compareValues(column.accessor(a), column.accessor(b)));
		}
	}

	const filteredCount = filtered.length;
	if (state.pageSize <= 0) {
		return { rows: filtered, filteredCount, pageCount: 1, pageIndex: 0 };
	}

	const pageCount = Math.max(1, Math.ceil(filteredCount / state.pageSize));
	const pageIndex = Math.min(state.pageIndex, pageCount - 1);
	const start = pageIndex * state.pageSize;
	return {
		rows: filtered.slice(start, start + state.pageSize),
		filteredCount,
		pageCount,
		pageIndex,
	};
}
