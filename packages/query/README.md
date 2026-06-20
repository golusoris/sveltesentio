# @sveltesentio/query

> TanStack Query v6 wrappers — load helpers, optimistic updates, SSR hydration

Part of the [sveltesentio](https://github.com/golusoris/sveltesentio) composable SvelteKit framework.

## Status

✅ v0.4.0 — `createQueryClient` (RFC 9457-aware retry on `ProblemError`),
`serverPrefetch` + `HydrationBoundary` (SSR load→dehydrate→hydrate, no refetch
flash), `createInfiniteItems` (cursor pagination), `useOptimistic` (RFC 9457
rollback), `createSentioQuery` / `createSentioMutation`. Client-agnostic — every
resolver is a plain async fn, so it composes with any openapi-fetch-shaped client.

### Reactive query keys

`createSentioQuery`, `createInfiniteItems` and `useConnectQuery` accept either a
plain options object **or an accessor** (`() => ({...})`). Pass the accessor form
when `queryKey` derives from `$state` (a sort filter, route param, search box) so
the key is re-read on every evaluation and TanStack refetches on change; the
plain-object form freezes the key at call time (static keys only).

```svelte
<script lang="ts">
  let sortBy = $state('added');
  // accessor form → re-reads sortBy, refetches when it changes
  const q = createSentioQuery(() => ({
    queryKey: ['movies', 'list', sortBy],
    queryFn: () => listMovies({ order_by: sortBy }),
  }));
</script>
```

The ConnectRPC bridge lives behind the [`./connect`](#sub-exports) subpath only,
so the package index stays free of the optional `@connectrpc/connect` +
`@bufbuild/protobuf` peers (an openapi-fetch app can import the index without them).

## Sub-exports

`.` · `./query-client` · `./query` · `./hydration` · `./infinite` · `./mutation` · `./connect`

## Installation

```bash
pnpm add @sveltesentio/query
```

See the [monorepo README](../../README.md) and [`docs/`](../../docs/) for design principles and usage.

## License

MIT © lusoris
