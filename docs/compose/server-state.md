# Server state — Query vs `$state`, decision flowchart

sveltesentio supports **two** server-state paths: `@tanstack/svelte-query@6`
(through `@sveltesentio/query`) and plain module-level `$state`. They are
both first-class — neither is "the right one". This recipe is the decision
flowchart + the migration pattern between them.

See [ADR-0008](../adr/0008-tanstack-svelte-query-v6.md) for the decision.

## TL;DR

```text
                    ┌─────────────────────────────────────┐
                    │ Do you need background refetch,     │
                    │ infinite scroll, or optimistic      │
                    │ mutations with auto-rollback?       │
                    └──────────────┬──────────────────────┘
                                   │
                          ┌────────┴────────┐
                          │ yes             │ no
                          ▼                 ▼
                   @sveltesentio/query  ┌────────────────────────────┐
                   (TanStack Query v6)  │ Do the same key-shape      │
                                        │ semantics matter across    │
                                        │ routes (pagination,        │
                                        │ filter state, invalidate)? │
                                        └──────────┬─────────────────┘
                                                   │
                                          ┌────────┴────────┐
                                          │ yes             │ no
                                          ▼                 ▼
                                   @sveltesentio/query   Module-level $state
                                                         (simplest path)
```

## Path 1 — module-level `$state`

The simplest path. Good for:

- **One-shot loads**: route `load()` fetches, page renders, done.
- **Small SPAs** that aren't worried about stale data in the background.
- **Forms with simple save flows** — post and redirect, no need for cache.
- **Light invalidation**: "refetch when X changed" is one line.

Pattern (Lurkarr / subdo style):

```ts
// lib/state/projects.svelte.ts
import { getClock } from '@sveltesentio/core/clock';

let cache = $state<{ fetchedAt: number; items: Project[] } | null>(null);
const STALE_AFTER_MS = 2 * 60_000;

export async function getProjects(): Promise<Project[]> {
  const now = getClock().now();
  if (cache && now - cache.fetchedAt < STALE_AFTER_MS) return cache.items;

  const { data, error } = await api.GET('/v1/projects');
  if (error) throw error;
  cache = { fetchedAt: now, items: data.items };
  return data.items;
}

export function invalidateProjects() {
  cache = null;
}
```

Consumption in a component:

```svelte
<script lang="ts">
  import { getProjects } from '$lib/state/projects.svelte';
  const projects = $derived(await getProjects());
</script>

{#each projects as project (project.id)}
  <article>{project.name}</article>
{/each}
```

**When this breaks down**: background polling, multiple overlapping
`queryKey`s, optimistic updates with rollback, paginated-cursor merging.
Migrate to Path 2.

## Path 2 — `@sveltesentio/query` (TanStack Query v6)

The feature-rich path. Good for:

- **Dashboards** with multiple widgets querying related keys.
- **Lists with optimistic updates**: create/edit/delete with visual
  commit-before-confirm.
- **Infinite scroll** / cursor pagination.
- **SSR-hydrated** apps where the server fetches and the client rehydrates
  without a re-fetch flash.

Install:

```bash
pnpm add @tanstack/svelte-query
# (peer pin @^6 — matches arca + revenge, see ADR-0008)
```

Wire once in root layout:

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import { QueryClientProvider } from '@tanstack/svelte-query';
  import { createQueryClient } from '@sveltesentio/query';
  import { setClock, systemClock } from '@sveltesentio/core/clock';

  setClock(systemClock);
  const queryClient = createQueryClient();
</script>

<QueryClientProvider client={queryClient}>
  <slot />
</QueryClientProvider>
```

`createQueryClient()` applies sveltesentio defaults:

- `staleTime: 120_000` (2 min — matches revenge evidence).
- `retry: 1` on non-4xx; no retry on `ProblemError.status` < 500.
- `networkMode: 'online'`.
- Structural sharing enabled.

Define a query factory:

```ts
// lib/queries/projects.ts
import { api } from '$lib/api/client';
import { createQuery } from '@sveltesentio/query';

export function projectsQuery() {
  return createQuery({
    queryKey: ['projects', 'list'] as const,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET('/v1/projects', { signal });
      if (error) throw error;
      return data.items;
    },
  });
}
```

Consume:

```svelte
<script lang="ts">
  import { projectsQuery } from '$lib/queries/projects';
  const q = projectsQuery();
</script>

{#if $q.isPending}
  <LoadingSkeleton />
{:else if $q.isError}
  <ErrorBanner error={$q.error} />
{:else}
  {#each $q.data as project (project.id)}
    <article>{project.name}</article>
  {/each}
{/if}
```

### SSR hydration (arca-style)

When the route is SSR-rendered, hydrate server-fetched data so the client
doesn't refetch on load:

```ts
// +page.server.ts
import { QueryClient, dehydrate } from '@tanstack/svelte-query';
import { api } from '$lib/api/client';

export async function load() {
  const qc = new QueryClient();
  await qc.prefetchQuery({
    queryKey: ['projects', 'list'] as const,
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/projects');
      if (error) throw error;
      return data.items;
    },
  });
  return { dehydratedState: dehydrate(qc) };
}
```

```svelte
<!-- +page.svelte -->
<script lang="ts">
  import { HydrationBoundary } from '@tanstack/svelte-query';
  let { data } = $props();
</script>

<HydrationBoundary state={data.dehydratedState}>
  <!-- component using projectsQuery() reads from the hydrated cache -->
</HydrationBoundary>
```

SPA-only apps (revenge / Lurkarr / subdo) skip the server `load` step — the
query fetches client-side on mount.

## Migrating from `$state` to Query

When a `$state` module outgrows its simple-cache shape, migrate by:

1. Replace the `let cache = $state(...)` with a `queryKey` shaped like the
   cache key. (`['projects']` → `['projects', 'list']`.)
2. Move the fetch into a `queryFn`.
3. Replace `invalidateX()` calls with `queryClient.invalidateQueries({ queryKey: ['projects'] })`.
4. Replace `getX()` callers with `createQuery`-returning factories.

No schema change. No component-shape change unless you want optimistic
updates.

## Anti-patterns

- **Using both paths for the same resource.** Pick one per resource.
  `projectsQuery()` + `getProjects()` both touching `/v1/projects` will
  cause cache-drift bugs.
- **Wrapping Query results in a `writable()` store.** Hard rule: `writable`
  is banned for server state (ADR-0008 + AGENTS.md hard rule 8). Query
  already exposes a Svelte store; don't double-wrap.
- **Treating `staleTime: 0` as a correctness feature.** If you truly need
  always-fresh, subscribe to a real-time stream (SSE / ConnectRPC stream)
  instead of polling at `staleTime: 0`.
- **Mutating query data in place.** `queryClient.setQueryData(key, updater)`
  is the only supported write path; structural sharing depends on it.

## References

- ADR-0008 — TanStack Query v6 pin + dual-path decision.
- ADR-0003 — thin Superforms wrapper (forms own their own state; not server
  state).
- ADR-0052 — clock injection (used above for stale-time checks in Path 1).
- TanStack Query docs: <https://tanstack.com/query/v5/docs/framework/svelte/overview>
  (v6 docs inherit most of v5).
