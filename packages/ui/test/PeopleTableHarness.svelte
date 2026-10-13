<!--
Test-only harness: renders `DataTable` over the `Person` fixture. `DataTable` is
generic over its row type. svelte-check types a `render(DataTable, …)` call with
the row type erased to `unknown`, and plain tsc sees a .svelte import as
untyped, so neither checks `Person` there. Inside this component the
instantiation is a normal Svelte expression, and svelte-check checks the rows,
columns and `rowKey` against `Person`.
-->
<script lang="ts">
	import DataTable from '../src/data/DataTable.svelte';
	import { columns, rows, type Person } from './people-fixture.js';

	const rowKey = (r: Person): number => r.id;
</script>

<DataTable {rows} {columns} label="People" {rowKey} />
