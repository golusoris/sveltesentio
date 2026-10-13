// Rows and columns the DataTable component tests render, shared by
// `PeopleTableHarness.svelte` and `DataTable.svelte.test.ts`.
import type { ColumnDef } from '../src/data/model.js';

export interface Person {
	id: number;
	name: string;
	age: number;
}

export const rows: readonly Person[] = [
	{ id: 1, name: 'Charlie', age: 30 },
	{ id: 2, name: 'Alice', age: 41 },
	{ id: 3, name: 'Bob', age: 22 },
];

export const columns: readonly ColumnDef<Person>[] = [
	{ id: 'name', header: 'Name', accessor: (r) => r.name },
	{ id: 'age', header: 'Age', accessor: (r) => r.age },
	{ id: 'id', header: 'ID', accessor: (r) => r.id, sortable: false },
];
