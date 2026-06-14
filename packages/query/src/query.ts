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
 */
export function createSentioQuery<TData, TKey extends QueryKey = QueryKey>(
	options: SentioQueryOptions<TData, TKey>,
) {
	return createQuery<TData, ProblemError, TData, TKey>(() => ({ staleTime: 30_000, ...options }));
}

/** Returns a function that invalidates queries by key against the active client. */
export function createQueryInvalidator(): (queryKey: QueryKey) => Promise<void> {
	const client = useQueryClient();
	return (queryKey: QueryKey) => client.invalidateQueries({ queryKey });
}
