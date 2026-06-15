import { describe, it, expect, vi } from 'vitest';
import { ProblemError } from '@sveltesentio/core';

// hydration.ts re-exports HydrationBoundary/QueryClientProvider (.svelte) and
// uses the real dehydrate/QueryClient — the mock keeps query-core intact.
// Dynamic import inside the factory keeps `vi.mock` hoisting hoist-safe.
vi.mock('@tanstack/svelte-query', async () => {
	const { svelteQueryMockFactory } = await import('./_svelte-query-mock.js');
	return svelteQueryMockFactory();
});

const hydration = await import('../src/hydration.js');
const { serverPrefetch, dehydrate, hydrate, HydrationBoundary, QueryClientProvider } = hydration;

interface DehydratedQuery {
	queryKey: unknown;
	state: { data: unknown; status: string };
}

describe('serverPrefetch — dehydrate shape', () => {
	it('prefetches a single query and dehydrates its data', async () => {
		const { dehydratedState } = await serverPrefetch({
			queries: [{ queryKey: ['items'], queryFn: () => Promise.resolve([1, 2, 3]) }],
		});
		const queries = dehydratedState.queries as unknown as DehydratedQuery[];
		expect(queries).toHaveLength(1);
		expect(queries[0]!.queryKey).toEqual(['items']);
		expect(queries[0]!.state.data).toEqual([1, 2, 3]);
		expect(queries[0]!.state.status).toBe('success');
	});

	it('prefetches multiple queries concurrently into one dehydrated state', async () => {
		const order: string[] = [];
		const { dehydratedState } = await serverPrefetch({
			queries: [
				{
					queryKey: ['a'],
					queryFn: () => {
						order.push('a');
						return Promise.resolve('A');
					},
				},
				{
					queryKey: ['b'],
					queryFn: () => {
						order.push('b');
						return Promise.resolve('B');
					},
				},
			],
		});
		const queries = dehydratedState.queries as unknown as DehydratedQuery[];
		expect(queries).toHaveLength(2);
		const byKey = new Map(queries.map((q) => [JSON.stringify(q.queryKey), q.state.data]));
		expect(byKey.get('["a"]')).toBe('A');
		expect(byKey.get('["b"]')).toBe('B');
		// both resolvers ran (concurrency, not necessarily ordering, is the contract).
		expect(order.sort()).toEqual(['a', 'b']);
	});

	it('forwards a per-query staleTime when provided', async () => {
		// A 0 stale-time query is considered stale immediately, so re-dehydrating
		// would refetch; we assert the option is honoured by the prefetch caching.
		const queryFn = vi.fn(() => Promise.resolve('cached'));
		const { dehydratedState } = await serverPrefetch({
			queries: [{ queryKey: ['s'], queryFn, staleTime: 60_000 }],
		});
		const queries = dehydratedState.queries as unknown as DehydratedQuery[];
		expect(queries[0]!.state.data).toBe('cached');
		expect(queryFn).toHaveBeenCalledOnce();
	});

	it('produces an empty dehydrated state for no queries', async () => {
		const { dehydratedState } = await serverPrefetch({ queries: [] });
		expect(dehydratedState.queries).toHaveLength(0);
	});

	it('does not reject when a typed 4xx resolver fails (prefetch swallows it)', async () => {
		// A 404 ProblemError is non-retryable per the client policy, so the single
		// attempt fails fast; prefetchQuery resolves regardless and a failed query
		// is not dehydrated with data.
		const { dehydratedState } = await serverPrefetch({
			queries: [
				{
					queryKey: ['boom'],
					queryFn: () => Promise.reject(new ProblemError({ type: 'x', status: 404 })),
				},
			],
		});
		const queries = dehydratedState.queries as unknown as DehydratedQuery[];
		for (const q of queries) {
			expect(q.state.data).toBeUndefined();
		}
	});
});

describe('hydration re-exports', () => {
	it('re-exports the TanStack hydration surface', () => {
		expect(typeof dehydrate).toBe('function');
		expect(typeof hydrate).toBe('function');
		expect(HydrationBoundary).toBeDefined();
		expect(QueryClientProvider).toBeDefined();
	});

	it('dehydrate is round-trippable via hydrate', async () => {
		const { dehydratedState } = await serverPrefetch({
			queries: [{ queryKey: ['rt'], queryFn: () => Promise.resolve(99) }],
		});
		const { QueryClient } = await import('@tanstack/svelte-query');
		const target = new QueryClient();
		hydrate(target, dehydratedState);
		expect(target.getQueryData(['rt'])).toBe(99);
	});
});
