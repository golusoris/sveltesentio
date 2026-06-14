import {
	createInfiniteQuery,
	type CreateInfiniteQueryOptions,
	type InfiniteData,
	type QueryKey,
} from '@tanstack/svelte-query';
import type { ProblemError } from '@sveltesentio/core';

export type { InfiniteData };

/** Cursor-paginated response shape. `nextCursor: null` signals the last page. */
export interface PagedResponse<TItem> {
	items: TItem[];
	nextCursor: string | null;
	total?: number;
}

export interface InfiniteItemsOptions<TItem, TKey extends QueryKey = QueryKey>
	extends Omit<
		CreateInfiniteQueryOptions<
			PagedResponse<TItem>,
			ProblemError,
			InfiniteData<PagedResponse<TItem>>,
			TKey,
			string | null
		>,
		'queryFn' | 'initialPageParam' | 'getNextPageParam'
	> {
	queryKey: TKey;
	queryFn: (cursor: string | null) => Promise<PagedResponse<TItem>>;
	/** First page cursor (default `null`). */
	initialCursor?: string | null;
}

/**
 * Cursor-based `createInfiniteQuery` preset for grids/feeds. Keeps previous data
 * during pagination so the grid doesn't flash. Works with any backend returning
 * `{ items, nextCursor, total? }`.
 */
export function createInfiniteItems<TItem, TKey extends QueryKey = QueryKey>(
	options: InfiniteItemsOptions<TItem, TKey>,
) {
	const { queryFn, initialCursor = null, ...rest } = options;
	return createInfiniteQuery<
		PagedResponse<TItem>,
		ProblemError,
		InfiniteData<PagedResponse<TItem>>,
		TKey,
		string | null
	>(() => ({
		staleTime: 30_000,
		...rest,
		queryFn: (ctx: { pageParam: string | null }) => queryFn(ctx.pageParam),
		initialPageParam: initialCursor,
		getNextPageParam: (lastPage: PagedResponse<TItem>) => lastPage.nextCursor,
	}));
}

/** Flatten infinite-query pages into a single item array. */
export function flattenPages<TItem>(
	data: InfiniteData<PagedResponse<TItem>> | undefined,
): TItem[] {
	return data?.pages.flatMap((page) => page.items) ?? [];
}
