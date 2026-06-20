# @sveltesentio/query

> TanStack Query v6 wrappers — load helpers, optimistic updates, SSR hydration

Part of the [sveltesentio](https://github.com/golusoris/sveltesentio) composable SvelteKit framework.

## Status

✅ v0.2.0 — `createQueryClient` (RFC 9457-aware retry on `ProblemError`),
`serverPrefetch` + `HydrationBoundary` (SSR load→dehydrate→hydrate, no refetch
flash), `createInfiniteItems` (cursor pagination), `useOptimistic` (RFC 9457
rollback), `createSentioQuery` / `createSentioMutation`. Client-agnostic — every
resolver is a plain async fn, so it composes with any openapi-fetch-shaped client.

## Sub-exports

`.` · `./query-client` · `./query` · `./hydration` · `./infinite` · `./mutation` · `./connect`

## Installation

```bash
pnpm add @sveltesentio/query
```

See the [monorepo README](../../README.md) and [`docs/`](../../docs/) for design principles and usage.

## License

MIT © lusoris
