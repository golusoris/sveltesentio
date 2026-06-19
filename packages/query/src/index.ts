// @sveltesentio/query — TanStack Query v6 for SvelteKit with RFC 9457 typing.
// Client-agnostic: every resolver is a plain async fn, so it composes with any
// openapi-fetch-shaped client (the typed client itself lives in @sveltesentio/api).

export { createQueryClient, isRetryableProblem } from './query-client.js';
export type { CreateQueryClientOptions } from './query-client.js';

export { createSentioQuery, createQueryInvalidator } from './query.js';
export type { SentioQueryOptions, QueryKey } from './query.js';

export {
	serverPrefetch,
	dehydrate,
	hydrate,
	HydrationBoundary,
	QueryClientProvider,
} from './hydration.js';
export type { DehydratedState, ServerPrefetchOptions, PrefetchSpec } from './hydration.js';

export { createInfiniteItems, flattenPages } from './infinite.js';
export type { PagedResponse, InfiniteItemsOptions, InfiniteData } from './infinite.js';

export { createSentioMutation, useOptimistic } from './mutation.js';
export type {
	SentioMutationOptions,
	OptimisticOptions,
	OptimisticContext,
	CreateMutationOptions,
} from './mutation.js';

export {
	useConnectQuery,
	createConnectQuery,
	connectQueryOptions,
	connectErrorToProblem,
} from './connect-query.js';
export type {
	ConnectQueryOptions,
	UnaryMethodSelector,
	ConnectErrorMapper,
} from './connect-query.js';

// Core TanStack primitives consumers commonly need directly.
export { QueryClient, useQueryClient } from '@tanstack/svelte-query';
