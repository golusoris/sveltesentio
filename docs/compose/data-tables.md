# Data tables — `@sveltesentio/ui/data` (DataTable + TanStack Virtual)

`@sveltesentio/ui/data` ships a generic `DataTable<T>` with column
defs, search, sort, pagination — plus a `<VirtualList>` wrapper around
`@tanstack/svelte-virtual@^3` that auto-wires WCAG-AA row semantics
(`role="grid"`, `aria-rowcount`, `aria-rowindex`, roving tabindex).

See [ADR-0011](../adr/0011-ui-data-wrapper-keep.md) (wrapper scope) and
[ADR-0024](../adr/0024-tanstack-virtual-a11y-wrapper.md) (ARIA-wired
virtualization). Related: [server-state.md](server-state.md)
(infinite-query preset), [ADR-0031](../adr/0031-a11y-testing-lane.md)
(axe-core lane).

## Install

```bash
pnpm add @sveltesentio/ui @sveltesentio/query @tanstack/svelte-virtual
```

Peer range: `@tanstack/svelte-virtual@^3`, `svelte@^5`. TanStack Query
(`@sveltesentio/query`) is a peer only when using the infinite-query
preset.

## Basic `DataTable<T>`

```svelte
<!-- src/routes/admin/users/+page.svelte -->
<script lang="ts" generics="User">
  import { DataTable, type ColumnDef } from '@sveltesentio/ui/data';
  import { Button } from '$lib/components/ui/button';

  type User = { id: string; name: string; email: string; role: 'admin' | 'editor' | 'viewer' };
  let { data } = $props();

  const columns: ColumnDef<User>[] = [
    {
      accessor: 'name',
      header: 'Name',
      sortable: true,
      cell: (row) => row.name,
    },
    {
      accessor: 'email',
      header: 'Email',
      sortable: true,
      searchable: true,
    },
    {
      accessor: 'role',
      header: 'Role',
      cell: (row) => row.role.toUpperCase(),
    },
    {
      id: 'actions',
      header: '',
      cell: (row) => ({
        component: ActionMenu,
        props: { userId: row.id },
      }),
    },
  ];
</script>

<DataTable data={data.users} {columns} pageSize={25} />
```

`DataTable<T>` ships: column defs, full-text search (across
`searchable: true` columns), per-column sort, pagination. All
concerns are opt-in — passing only `data` + `columns` renders a bare
sortable table.

### `ColumnDef<T>` shape

```ts
type ColumnDef<T> = {
  /** Unique column ID; defaults to `accessor` if provided */
  id?: string;
  /** Row property for typed accessors (alternative to `cell`) */
  accessor?: keyof T;
  /** Header label (string or component) */
  header: string | { component: Component; props?: Record<string, unknown> };
  /** Render a row cell */
  cell?: (row: T) => unknown | { component: Component; props?: Record<string, unknown> };
  /** Enable sort on this column */
  sortable?: boolean;
  /** Include in full-text search */
  searchable?: boolean;
  /** CSS class on the `<td>` */
  class?: string;
  /** Width hint (`'100px'` | `'1fr'` | `'minmax(100px, 1fr)'`) */
  width?: string;
  /** Accessibility label if the header isn't text */
  ariaLabel?: string;
};
```

Typed via `T` — accessor autocompletes to `T`'s keys, `cell` receives
`T`. No `any`.

## Virtualization

For > ~200 rows, drop in virtualization:

```svelte
<DataTable data={data.users} {columns} virtualize={{ rowHeight: 48 }} />
```

`virtualize` is an object (not boolean) so it can carry options:

```ts
type VirtualizeOptions = {
  rowHeight: number | ((index: number, row: T) => number); // px
  overscan?: number;        // default 5
  estimateRow?: number;     // for dynamic heights
  scrollingDelay?: number;  // ms, default 150
};
```

For dynamic row heights (variable content), use
`rowHeight: (i, row) => compute(row)` and provide an `estimateRow` for
the initial overscan math.

### Under the hood

`DataTable` with `virtualize` wraps rows in `<VirtualList>`, which
configures `@tanstack/svelte-virtual`'s `createVirtualizer`:

```svelte
<!-- inside ui/data/VirtualList.svelte (simplified) -->
<script lang="ts">
  import { createVirtualizer } from '@tanstack/svelte-virtual';
  import { cn } from '$lib/utils';

  let scrollRef: HTMLDivElement;
  const virtualizer = $derived(
    createVirtualizer({
      count: rows.length,
      getScrollElement: () => scrollRef,
      estimateSize: (i) => (typeof rowHeight === 'function' ? rowHeight(i, rows[i]) : rowHeight),
      overscan,
    }),
  );
</script>

<div
  bind:this={scrollRef}
  role="grid"
  aria-rowcount={rows.length}
  aria-colcount={columns.length}
  class="overflow-auto"
>
  <div style="height: {$virtualizer.getTotalSize()}px; position: relative">
    {#each $virtualizer.getVirtualItems() as vi (vi.key)}
      <div
        role="row"
        aria-rowindex={vi.index + 1}
        style="position: absolute; top: 0; transform: translateY({vi.start}px); height: {vi.size}px"
      >
        <!-- cells via column defs -->
      </div>
    {/each}
  </div>
</div>
```

The consumer never writes this — `DataTable` / `<VirtualList>` handle
it. Listed here because awareness of the ARIA scaffolding matters when
debugging.

## Keyboard navigation

The wrapper ships roving tabindex on rows:

| Key | Action |
|---|---|
| `↑` / `↓` | Move focus to prev / next row |
| `Home` / `End` | First / last row |
| `PageUp` / `PageDown` | ±10 rows |
| `Enter` | Invokes row's primary action (if wired) |
| `Tab` / `Shift+Tab` | Escape the grid |

For per-cell focus (editable cells), opt in via
`cellNavigation: true`. Adds `aria-colindex` per cell + arrow keys
move horizontally.

## Infinite query preset

The revenge-style offset-based infinite pagination:

```svelte
<script lang="ts">
  import { DataTable, useInfiniteData } from '@sveltesentio/ui/data';
  import { api } from '$lib/api';
  import type { Movie } from '$lib/types';

  const columns = [
    { accessor: 'title', header: 'Title', sortable: true, searchable: true },
    { accessor: 'year', header: 'Year' },
    { accessor: 'rating', header: '★', cell: (r) => '★'.repeat(r.rating) },
  ] satisfies ColumnDef<Movie>[];

  const movies = useInfiniteData({
    queryKey: ['movies'],
    pageSize: 50,
    queryFn: async ({ pageParam }) => {
      const { data } = await api.GET('/movies', {
        params: { query: { offset: pageParam, limit: 50 } },
      });
      return { items: data.items, nextOffset: data.nextOffset };
    },
  });
</script>

<DataTable
  data={movies.flat}
  {columns}
  virtualize={{ rowHeight: 48 }}
  onscrollend={() => movies.fetchNextPage()}
  loading={movies.isFetchingNextPage}
/>
```

`useInfiniteData()` wraps TanStack Query's `useInfiniteQuery` with the
offset/nextOffset shape. `movies.flat` is a flattened array of
all fetched pages — drives the table directly.

`onscrollend` fires when scroll reaches `overscan` rows from the end;
debounce is baked in (150ms).

## Search

```svelte
<DataTable
  data={data.users}
  {columns}
  searchable
  searchPlaceholder="Search users…"
/>
```

Search is client-side by default — filters over columns marked
`searchable: true`. For server-side search, wire your own `<input>`
and pass `data={filtered}`:

```svelte
<script lang="ts">
  let query = $state('');
  const filtered = $derived.by(() => {
    const q = query.toLowerCase();
    if (!q) return data.users;
    return data.users.filter((u) =>
      u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
    );
  });
</script>

<input bind:value={query} placeholder="Search…" />
<DataTable data={filtered} {columns} />
```

For large datasets, debounce + server-side query via TanStack Query.

## Sorting

Sort is client-side when `data` is small; for server-side sort, pass
`onSortChange`:

```svelte
<DataTable
  data={data.users}
  {columns}
  sortBy={sortState.by}
  sortDir={sortState.dir}
  onSortChange={(by, dir) => {
    sortState = { by, dir };
    // triggers your query refetch via TanStack Query
  }}
/>
```

## Empty / loading states

```svelte
<DataTable data={users} {columns} loading={query.isLoading}>
  {#snippet empty()}
    <div class="py-12 text-center">
      <p class="text-muted-fg">No users yet.</p>
      <Button onclick={inviteUser}>Invite someone</Button>
    </div>
  {/snippet}
</DataTable>
```

Loading renders a skeleton; empty renders the snippet (fallback: a
muted "No data" line).

## When to hand-roll

The wrapper stays unopinionated so `arca`'s hand-roll-everything
pattern doesn't repeat. Drop to raw `<VirtualList>` + your own `<table>`
when:

- You need non-grid semantics (e.g. infinite chat feed, changelog).
  `DataTable` assumes row + column structure.
- Your row is a rich card, not a row of cells. `DataTable` renders
  `<tr><td>` — a card grid needs `<ul><li>` + `role="listbox"` or `"grid"`
  with custom cell markup.
- You need a masonry / waterfall layout. `DataTable` assumes fixed
  row height per virtual item.

For those, use `<VirtualList>` standalone:

```svelte
<script lang="ts">
  import { VirtualList } from '@sveltesentio/ui/data';
</script>

<VirtualList items={messages} itemHeight={80} role="log" aria-label="Conversation">
  {#snippet item(msg)}
    <Message {msg} />
  {/snippet}
</VirtualList>
```

Pass `role="log"` / `"list"` / `"feed"` to override the default
`"grid"`. The wrapper still handles measurement + overscan + keyboard
roving.

## Testing

Unit + a11y:

```ts
import { render, screen } from '@testing-library/svelte';
import { axe } from 'jest-axe';
import { DataTable } from '@sveltesentio/ui/data';

test('renders rows with aria-rowindex', () => {
  const { container } = render(DataTable, {
    props: {
      data: users,
      columns: [{ accessor: 'name', header: 'Name' }],
    },
  });
  const rows = container.querySelectorAll('[role="row"]');
  expect(rows[0].getAttribute('aria-rowindex')).toBe('1');
});

test('axe-clean', async () => {
  const { container } = render(DataTable, { props: { data: users, columns } });
  expect(await axe(container)).toHaveNoViolations();
});
```

Playwright for keyboard navigation:

```ts
test('arrow keys move row focus', async ({ page }) => {
  await page.goto('/admin/users');
  await page.locator('[role="row"]').first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[role="row"][aria-rowindex="2"]')).toBeFocused();
});
```

## Anti-patterns

- **Raw `@tanstack/svelte-virtual` without the wrapper.** Ships no
  ARIA. Every consumer re-implements `role="grid"` + `aria-rowcount` +
  `aria-rowindex`. Use `<VirtualList>`.
- **Bundling `@vincjo/datatables`.** arca has it in deps and still
  hand-rolls — evidence of API misfit. ADR-0011 rejected.
- **Mandating TanStack Table.** Heavier API than this wrapper; reach
  for it only if you hit Lurkarr's generic limits (pivots, expanded
  rows, column groups).
- **Rendering > 200 rows without virtualization.** Jank + memory
  spike. Turn on `virtualize`.
- **Dynamic row heights without `estimateRow`.** Initial overscan
  math fails → layout thrash. Always provide an estimate.
- **Using `DataTable` for non-tabular content.** Chat feeds, card
  grids, masonry: drop to `<VirtualList>` with a different role.
- **Skipping `searchable` / `sortable` flags and hand-filtering.**
  The wrapper's search + sort are already there; toggle them.
- **Opinionated column components in the wrapper.** `cell` accepts a
  value OR `{ component, props }`. Don't bake cell components into
  `ui/data`. arca's hand-rolling pattern is the warning.
- **Skipping the axe-core lane.** A data table is prime a11y failure
  surface. ADR-0031 is non-optional.

## References

- ADR-0011 — `ui/data` wrapper scope.
- ADR-0024 — TanStack Virtual ARIA wrapper.
- ADR-0031 — a11y testing lane.
- [server-state.md](server-state.md) — TanStack Query infinite queries.
- `@tanstack/svelte-virtual` docs: <https://tanstack.com/virtual/latest>.
