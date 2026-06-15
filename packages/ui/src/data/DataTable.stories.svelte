<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import DataTable from './DataTable.svelte';
  import type { ColumnDef } from './model.js';

  interface User {
    readonly id: number;
    readonly name: string;
    readonly email: string;
    readonly role: string;
    readonly active: boolean;
  }

  const rows: readonly User[] = [
    { id: 1, name: 'Ada Lovelace', email: 'ada@example.com', role: 'Owner', active: true },
    { id: 2, name: 'Alan Turing', email: 'alan@example.com', role: 'Admin', active: true },
    { id: 3, name: 'Grace Hopper', email: 'grace@example.com', role: 'Editor', active: false },
    {
      id: 4,
      name: 'Katherine Johnson',
      email: 'katherine@example.com',
      role: 'Editor',
      active: true,
    },
    {
      id: 5,
      name: 'Margaret Hamilton',
      email: 'margaret@example.com',
      role: 'Viewer',
      active: false,
    },
  ];

  const columns: readonly ColumnDef<User>[] = [
    { id: 'name', header: 'Name', accessor: (r) => r.name },
    { id: 'email', header: 'Email', accessor: (r) => r.email },
    { id: 'role', header: 'Role', accessor: (r) => r.role },
    { id: 'active', header: 'Active', accessor: (r) => (r.active ? 'Yes' : 'No') },
  ];

  const { Story } = defineMeta({
    title: 'ui/data/DataTable',
    // `generics="TRow"` makes the component generic; cast keeps the meta typed
    // while the stories below supply concrete `User` rows.
    component: DataTable as unknown as typeof DataTable<User>,
    tags: ['autodocs'],
    args: {
      rows,
      columns,
      label: 'Team members',
      rowKey: (row: User) => row.id,
    },
  });
</script>

<!-- Default grid: sortable headers expose `aria-sort`; click/Enter to sort. -->
<Story name="Default" args={{ rows, columns, label: 'Team members', rowKey: (r) => r.id }} />

<!-- Pre-sorted descending by name. -->
<Story
  name="Sorted by name"
  args={{
    rows,
    columns,
    label: 'Team members sorted by name',
    rowKey: (r) => r.id,
    initialState: { sort: { columnId: 'name', direction: 'desc' } },
  }}
/>

<!-- Paginated to 2 rows per page. -->
<Story
  name="Paginated"
  args={{
    rows,
    columns,
    label: 'Team members, page 1',
    rowKey: (r) => r.id,
    initialState: { pageSize: 2 },
  }}
/>
