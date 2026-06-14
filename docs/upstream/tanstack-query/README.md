---
pinned-version: 6.x
canonical-url: https://tanstack.com/query/latest/docs/framework/svelte/overview
last-verified: 2026-04-18
---

# TanStack Svelte Query — v6.x snapshot

Pinned: **`@tanstack/svelte-query ^6.0.0`** (peerDependency in `@sveltesentio/query`, per [ADR-0008](../../adr/0008-tanstack-svelte-query-v6.md))
Canonical: <https://tanstack.com/query/latest/docs/framework/svelte/overview>

The v6 Svelte adapter is **runes-first**: hook results are rune-backed reactive objects, not Svelte stores. You read `query.data` directly (no leading `$`). Options are passed as an **accessor** (`() => options`) so the adapter can track dependency changes reactively.

## Setup

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
  import { browser } from '$app/environment';

  let { children } = $props();
  const client = new QueryClient({
    defaultOptions: { queries: { enabled: browser, staleTime: 60_000 } }
  });
</script>

<QueryClientProvider {client}>
  {@render children()}
</QueryClientProvider>
```

## `createQuery`

```svelte
<script lang="ts">
  import { createQuery } from '@tanstack/svelte-query';

  // Pass a function returning options (accessor), NOT the raw object.
  const posts = createQuery(() => ({
    queryKey: ['posts'],
    queryFn: async () => (await fetch('/api/posts')).json(),
    staleTime: 60_000
  }));
</script>

{#if posts.isPending}
  …
{:else if posts.error}
  {posts.error.message}
{:else}
  {#each posts.data as p}{p.title}{/each}
{/if}
```

`createQuery` returns a rune-backed reactive object. Read fields directly (`posts.data`, `posts.isPending`) — **no `$` prefix**. The `() => options` accessor is tracked: when `$state` referenced inside changes, the query reruns.

## `createMutation`

```ts
import { createMutation, useQueryClient } from '@tanstack/svelte-query';

const qc = useQueryClient();
const create = createMutation(() => ({
  mutationFn: (input: { title: string }) => fetch('/api/posts', { method: 'POST', body: JSON.stringify(input) }),
  onSuccess: () => qc.invalidateQueries({ queryKey: ['posts'] })
}));

create.mutate({ title: 'hi' });
await create.mutateAsync({ title: 'hi' });
```

## `createInfiniteQuery`

```ts
const feed = createInfiniteQuery(() => ({
  queryKey: ['feed'],
  queryFn: ({ pageParam }) => fetchPage(pageParam),
  initialPageParam: 0,
  getNextPageParam: (last) => last.nextCursor ?? undefined
}));
```

## SSR / SvelteKit

```ts
// +page.server.ts
import { dehydrate, QueryClient } from '@tanstack/svelte-query';

export const load = async () => {
  const qc = new QueryClient();
  await qc.prefetchQuery({ queryKey: ['posts'], queryFn: fetchPosts });
  return { dehydratedState: dehydrate(qc) };
};
```

```svelte
<!-- +layout.svelte -->
<script>
  import { HydrationBoundary } from '@tanstack/svelte-query';
  let { data, children } = $props();
</script>

<HydrationBoundary state={data.dehydratedState}>
  {@render children()}
</HydrationBoundary>
```

## Query invalidation patterns

```ts
qc.invalidateQueries({ queryKey: ['posts'] });               // exact + descendants
qc.invalidateQueries({ queryKey: ['posts'], exact: true });
qc.setQueryData(['post', id], (old) => ({ ...old, title })); // optimistic
qc.cancelQueries({ queryKey: ['posts'] });                   // before optimistic write
```

## `sveltesentio` usage

- `@sveltesentio/query` re-exports `createQuery`, `createMutation`, `createInfiniteQuery`, `QueryClient`, `QueryClientProvider`, `HydrationBoundary` and the SSR `dehydrate` helper.
- `writable()` for server state is **forbidden** ([CLAUDE.md](../../../CLAUDE.md) "Don't" list) — use `createQuery` / `createMutation`.
- Default `staleTime` convention: framework pin `30_000`; revenge's production default is `120_000`. Override per query.

## Gotchas

- **v5 → v6 breaking: options are an accessor.** `createQuery({ ... })` compiles but does not track reactively; you must write `createQuery(() => ({ ... }))`. This is the single most common v6 migration mistake.
- **v5 → v6 breaking: no more Svelte-store return.** v5 returned a readable store (`$query.data`); v6 returns a rune-backed object (`query.data`). Drop the `$`.
- Consumers of v6 hooks must live in a rune context — `.svelte` components or `.svelte.ts` modules. Plain `.ts` files cannot use them.
- `enabled: browser` (from `$app/environment`) avoids running queries during SSR when you don't want them; combine with `prefetchQuery` for what you do want hydrated.
- `queryKey` must be a serialisable array; nesting objects is fine but functions are not.
- `onSuccess`/`onError` callbacks on `createQuery` were removed in v5 and remain absent in v6 — react with `$effect` to `query.data` / `query.error` instead.

## Links

- [v5 → v6 migration](https://tanstack.com/query/latest/docs/framework/svelte/guides/migrating-to-v6)
- [Svelte adapter overview](https://tanstack.com/query/latest/docs/framework/svelte/overview)
- [SSR with SvelteKit](https://tanstack.com/query/latest/docs/framework/svelte/ssr)
