/**
 * SSR hydration helpers for SvelteKit + TanStack Query.
 *
 * Server pattern (in +page.server.ts or +layout.server.ts):
 *   return { dehydratedState: await serverPrefetch(...) };
 *
 * Client pattern (in +layout.svelte or +page.svelte):
 *   import { HydrationBoundary } from '@sveltesentio/query';
 *   <HydrationBoundary state={data.dehydratedState}>
 *     {@render children()}
 *   </HydrationBoundary>
 */

export type { DehydratedState } from '@tanstack/svelte-query';
export { dehydrate, hydrate, HydrationBoundary } from '@tanstack/svelte-query';

import { QueryClient } from '@tanstack/svelte-query';
import { dehydrate } from '@tanstack/svelte-query';

export interface ServerPrefetchOptions {
  queries: Array<{
    queryKey: unknown[];
    queryFn: () => Promise<unknown>;
    staleTime?: number;
  }>;
}

/**
 * Prefetch multiple queries on the server and return dehydrated state.
 * Designed for use in SvelteKit load() functions.
 *
 * // +layout.server.ts
 * export const load: LayoutServerLoad = async ({ locals }) => {
 *   const { dehydratedState } = await serverPrefetch({
 *     queries: [
 *       { queryKey: ['user', locals.session?.userId], queryFn: () => fetchUser() },
 *       { queryKey: ['config'], queryFn: () => fetchConfig(), staleTime: Infinity },
 *     ],
 *   });
 *   return { dehydratedState };
 * };
 */
export async function serverPrefetch(options: ServerPrefetchOptions): Promise<{
  dehydratedState: ReturnType<typeof dehydrate>;
}> {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000 },
    },
  });

  await Promise.all(
    options.queries.map(({ queryKey, queryFn, staleTime }) =>
      queryClient.prefetchQuery({
        queryKey,
        queryFn,
        ...(staleTime !== undefined ? { staleTime } : {}),
      }),
    ),
  );

  return { dehydratedState: dehydrate(queryClient) };
}
