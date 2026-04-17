import {
  createInfiniteQuery as tanstackCreateInfiniteQuery,
  type CreateInfiniteQueryOptions,
  type InfiniteData,
  type QueryKey,
} from '@tanstack/svelte-query';
import type { AppError } from '@sveltesentio/core';

export type { InfiniteData };

export interface PagedResponse<TItem> {
  items: TItem[];
  nextCursor: string | null;
  total?: number;
}

export interface InfiniteQueryOptions<TItem, TKey extends QueryKey = QueryKey>
  extends Omit<
    CreateInfiniteQueryOptions<
      PagedResponse<TItem>,
      AppError,
      InfiniteData<PagedResponse<TItem>>,
      PagedResponse<TItem>,
      TKey,
      string | null
    >,
    'queryFn' | 'initialPageParam' | 'getNextPageParam'
  > {
  queryKey: TKey;
  queryFn: (cursor: string | null) => Promise<PagedResponse<TItem>>;
  /** Initial page cursor. Defaults to null (first page). */
  initialCursor?: string | null;
}

/**
 * createInfiniteQuery for cursor-based pagination.
 * Works with any backend that returns { items, nextCursor, total? }.
 *
 * const feed = createInfiniteItems({
 *   queryKey: ['feed'],
 *   queryFn: (cursor) => api.GET('/feed', { params: { query: { cursor } } })
 *     .then(r => r.data ?? { items: [], nextCursor: null }),
 * });
 *
 * // In template:
 * {#each $feed.data?.pages.flatMap(p => p.items) ?? [] as item}
 *   <Item {item} />
 * {/each}
 * <button
 *   onclick={() => $feed.fetchNextPage()}
 *   disabled={!$feed.hasNextPage || $feed.isFetchingNextPage}
 * >Load more</button>
 */
export function createInfiniteItems<TItem, TKey extends QueryKey = QueryKey>(
  options: InfiniteQueryOptions<TItem, TKey>,
) {
  const { queryFn, initialCursor = null, ...rest } = options;

  return tanstackCreateInfiniteQuery<
    PagedResponse<TItem>,
    AppError,
    InfiniteData<PagedResponse<TItem>>,
    TKey,
    string | null
  >({
    ...rest,
    queryFn: ({ pageParam }) => queryFn(pageParam),
    initialPageParam: initialCursor,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? null,
  });
}

/** Flatten all pages of an infinite query result into a single array. */
export function flattenPages<TItem>(
  data: InfiniteData<PagedResponse<TItem>> | undefined,
): TItem[] {
  return data?.pages.flatMap((p) => p.items) ?? [];
}
