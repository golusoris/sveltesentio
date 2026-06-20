import {
	createQuery,
	useQueryClient,
	type CreateQueryOptions,
	type QueryKey,
} from '@tanstack/svelte-query';
import type { ProblemError } from '@sveltesentio/core';

export type { QueryKey };

export interface SentioQueryOptions<TData, TKey extends QueryKey = QueryKey>
	extends Omit<CreateQueryOptions<TData, ProblemError, TData, TKey>, 'queryFn'> {
	queryKey: TKey;
	/** Resolver — typically wraps an openapi-fetch-shaped client. Throws `ProblemError` on failure. */
	queryFn: () => Promise<TData>;
}

/**
 * `createQuery` with the sveltesentio error type (`ProblemError`) and a 30s
 * stale-time default. Client-agnostic: `queryFn` is any async resolver, so it
 * works against any openapi-fetch-shaped client (not coupled to a specific one).
 *
 * Pass the **accessor form** (`() => ({...})`) when `queryKey` derives from
 * `$state` (a sort filter, route param, search box): the accessor re-runs on
 * every read, so TanStack sees the key change and refetches. The plain-object
 * form freezes the key at call time — fine for static keys (e.g. a detail page
 * whose id is fixed per mount), but a reactive key there never refetches.
 */
export function createSentioQuery<TData, TKey extends QueryKey = QueryKey>(
	options: SentioQueryOptions<TData, TKey> | (() => SentioQueryOptions<TData, TKey>),
) {
	const get = typeof options === 'function' ? options : () => options;
	return createQuery<TData, ProblemError, TData, TKey>(() => ({ staleTime: 30_000, ...get() }));
}

/** Returns a function that invalidates queries by key against the active client. */
export function createQueryInvalidator(): (queryKey: QueryKey) => Promise<void> {
	const client = useQueryClient();
	return (queryKey: QueryKey) => client.invalidateQueries({ queryKey });
}
