// API client
export type { ApiClientOptions, ApiClient, PathsWithMethod } from './client.js';
export { createApiClient } from './client.js';

// Queries
export type { LoadQueryOptions, LoadQueryResult } from './query.js';
export { createSentioQuery, prefetchQuery, createQueryInvalidator } from './query.js';

// Mutations
export type { SentioMutationOptions } from './mutation.js';
export { createMutation } from './mutation.js';

// SSR hydration
export type { DehydratedState, ServerPrefetchOptions } from './hydration.js';
export { dehydrate, hydrate, HydrationBoundary, serverPrefetch } from './hydration.js';

// Infinite / paginated queries
export type { PagedResponse, InfiniteQueryOptions, InfiniteData } from './infinite.js';
export { createInfiniteItems, flattenPages } from './infinite.js';

// Re-export core TanStack primitives apps may need directly
export {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from '@tanstack/svelte-query';
