import { dehydrate, type DehydratedState, type QueryKey } from '@tanstack/svelte-query';
import { createQueryClient } from './query-client.js';

export type { DehydratedState };
export { dehydrate, hydrate, HydrationBoundary, QueryClientProvider } from '@tanstack/svelte-query';

export interface PrefetchSpec {
	queryKey: QueryKey;
	queryFn: () => Promise<unknown>;
	staleTime?: number;
}

export interface ServerPrefetchOptions {
	queries: readonly PrefetchSpec[];
}

/**
 * Prefetch queries on the server and return dehydrated state for the client.
 * Pair with `<HydrationBoundary state={data.dehydratedState}>` so the first
 * client render reuses server data with no refetch flash.
 *
 * ```ts
 * // +page.server.ts
 * export const load = async () => ({
 *   dehydratedState: (await serverPrefetch({ queries: [
 *     { queryKey: ['items'], queryFn: () => fetchItems() },
 *   ] })).dehydratedState,
 * });
 * ```
 */
export async function serverPrefetch(
	options: ServerPrefetchOptions,
): Promise<{ dehydratedState: DehydratedState }> {
	const client = createQueryClient();
	await Promise.all(
		options.queries.map(({ queryKey, queryFn, staleTime }) =>
			client.prefetchQuery({
				queryKey,
				queryFn,
				...(staleTime !== undefined ? { staleTime } : {}),
			}),
		),
	);
	return { dehydratedState: dehydrate(client) };
}
