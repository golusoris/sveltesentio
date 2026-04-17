import {
  createQuery as tanstackCreateQuery,
  useQueryClient,
  type CreateQueryOptions,
  type QueryKey,
} from '@tanstack/svelte-query';
import type { AppError } from '@sveltesentio/core';

export type { QueryKey, CreateQueryOptions };

export interface LoadQueryOptions<TData, TKey extends QueryKey = QueryKey>
  extends Omit<CreateQueryOptions<TData, AppError, TData, TKey>, 'queryFn'> {
  queryKey: TKey;
  queryFn: () => Promise<TData>;
}

/**
 * Thin wrapper around TanStack's createQuery with sveltesentio error typing.
 * Use in components and +page.svelte files.
 *
 * const items = createSentioQuery({
 *   queryKey: ['items'],
 *   queryFn: () => api.GET('/items').then(r => r.data ?? []),
 * });
 */
export function createSentioQuery<TData, TKey extends QueryKey = QueryKey>(
  options: LoadQueryOptions<TData, TKey>,
) {
  return tanstackCreateQuery<TData, AppError, TData, TKey>({
    staleTime: 30_000,
    ...options,
  });
}

export interface LoadQueryResult<TData> {
  dehydratedState: unknown;
  initialData?: TData;
}

/**
 * Prefetch a query in a SvelteKit load() function and return the dehydrated state.
 * Pair with HydrationBoundary on the client (see hydration.ts).
 *
 * // +page.server.ts
 * export const load: PageServerLoad = async () => {
 *   return prefetchQuery({
 *     queryKey: ['items'],
 *     queryFn: () => fetchItems(),
 *   });
 * };
 */
export async function prefetchQuery<TData, TKey extends QueryKey = QueryKey>(
  options: LoadQueryOptions<TData, TKey>,
): Promise<LoadQueryResult<TData>> {
  const { QueryClient, dehydrate } = await import('@tanstack/svelte-query');
  const queryClient = new QueryClient();

  await queryClient.prefetchQuery({
    queryKey: options.queryKey,
    queryFn: options.queryFn,
    staleTime: options.staleTime ?? 30_000,
  });

  const dehydratedState = dehydrate(queryClient);
  return { dehydratedState };
}

/**
 * Invalidate queries by key prefix from a component.
 *
 * const invalidate = createQueryInvalidator();
 * invalidate(['items']); // invalidates all keys starting with 'items'
 */
export function createQueryInvalidator() {
  const client = useQueryClient();
  return (keys: QueryKey[]) => {
    return Promise.all(keys.map((key) => client.invalidateQueries({ queryKey: key })));
  };
}
