import {
	createMutation,
	useQueryClient,
	type CreateMutationOptions,
	type QueryKey,
} from '@tanstack/svelte-query';
import type { ProblemError } from '@sveltesentio/core';

export type { CreateMutationOptions };

export interface SentioMutationOptions<TData, TVariables, TContext = unknown>
	extends Omit<CreateMutationOptions<TData, ProblemError, TVariables, TContext>, 'mutationFn'> {
	mutationFn: (variables: TVariables) => Promise<TData>;
	/** Query keys to invalidate once the mutation settles. */
	invalidates?: readonly QueryKey[];
}

/**
 * `createMutation` typed with `ProblemError`, plus optional `invalidates` that
 * refetch the listed keys on settle. No toast coupling — surface results through
 * `@sveltesentio/ui` toast in the caller if desired.
 */
export function createSentioMutation<TData, TVariables = void, TContext = unknown>(
	options: SentioMutationOptions<TData, TVariables, TContext>,
) {
	const client = useQueryClient();
	const { invalidates, ...rest } = options;
	return createMutation<TData, ProblemError, TVariables, TContext>(() => ({
		...rest,
		onSettled: (...args: Parameters<NonNullable<typeof rest.onSettled>>) => {
			if (invalidates) {
				for (const queryKey of invalidates) void client.invalidateQueries({ queryKey });
			}
			return rest.onSettled?.(...args);
		},
	}));
}

export interface OptimisticContext<TSnapshot> {
	previous: TSnapshot | undefined;
}

export interface OptimisticOptions<TData, TVariables, TSnapshot> {
	mutationFn: (variables: TVariables) => Promise<TData>;
	/** Cache entry to optimistically update and roll back. */
	queryKey: QueryKey;
	/** Produce the optimistic snapshot from the previous value + variables. */
	optimisticUpdate: (previous: TSnapshot | undefined, variables: TVariables) => TSnapshot;
	/** Re-fetch the key after settle to reconcile (default true). */
	invalidateOnSettled?: boolean;
}

/**
 * Optimistic mutation with RFC 9457 rollback: snapshots the cache, applies the
 * optimistic value, and on failure (including a typed `ProblemError`) restores
 * the snapshot. Reconciles by invalidating the key once settled.
 */
export function useOptimistic<TData, TVariables, TSnapshot>(
	options: OptimisticOptions<TData, TVariables, TSnapshot>,
) {
	const client = useQueryClient();
	const { mutationFn, queryKey, optimisticUpdate, invalidateOnSettled = true } = options;
	return createMutation<TData, ProblemError, TVariables, OptimisticContext<TSnapshot>>(() => ({
		mutationFn,
		onMutate: async (variables) => {
			await client.cancelQueries({ queryKey });
			const previous = client.getQueryData<TSnapshot>(queryKey);
			client.setQueryData<TSnapshot>(queryKey, optimisticUpdate(previous, variables));
			return { previous };
		},
		onError: (_error, _variables, context) => {
			if (context) client.setQueryData(queryKey, context.previous);
		},
		onSettled: () => {
			if (invalidateOnSettled) void client.invalidateQueries({ queryKey });
		},
	}));
}
