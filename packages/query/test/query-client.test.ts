import { describe, it, expect, vi } from 'vitest';
import { ProblemError } from '@sveltesentio/core';

// query-client.ts imports `QueryClient` from @tanstack/svelte-query, whose
// barrel re-exports `.svelte` files. Mock keeps the real query-core QueryClient.
// The factory is dynamically imported *inside* the mock body so `vi.mock`
// hoisting does not hit the helper's temporal dead zone.
vi.mock('@tanstack/svelte-query', async () => {
	const { svelteQueryMockFactory } = await import('./_svelte-query-mock.js');
	return svelteQueryMockFactory();
});

const { createQueryClient } = await import('../src/query-client.js');

type QueriesDefaults = {
	staleTime?: number;
	retry?: (failureCount: number, error: unknown) => boolean;
	retryDelay?: (attempt: number) => number;
};

function queries(client: ReturnType<typeof createQueryClient>): QueriesDefaults {
	return client.getDefaultOptions().queries as QueriesDefaults;
}

describe('createQueryClient — defaults', () => {
	it('applies the 30s stale-time default', () => {
		expect(queries(createQueryClient()).staleTime).toBe(30_000);
	});

	it('exposes a retry predicate and an exponential retryDelay', () => {
		const q = queries(createQueryClient());
		expect(typeof q.retry).toBe('function');
		expect(typeof q.retryDelay).toBe('function');
	});

	it('retryDelay grows exponentially and caps at 30s', () => {
		const { retryDelay } = queries(createQueryClient());
		expect(retryDelay!(0)).toBe(1_000);
		expect(retryDelay!(1)).toBe(2_000);
		expect(retryDelay!(2)).toBe(4_000);
		// 1000 * 2**5 = 32_000 -> capped.
		expect(retryDelay!(5)).toBe(30_000);
		expect(retryDelay!(20)).toBe(30_000);
	});
});

describe('createQueryClient — retry predicate (RFC 9457 + attempt cap)', () => {
	it('retries transient failures until maxRetries is reached', () => {
		const { retry } = queries(createQueryClient());
		const transient = new ProblemError({ type: 'x', status: 503 });
		expect(retry!(0, transient)).toBe(true);
		expect(retry!(1, transient)).toBe(true);
		expect(retry!(2, transient)).toBe(true);
		// default maxRetries = 3 -> failureCount 3 is no longer < 3.
		expect(retry!(3, transient)).toBe(false);
	});

	it('never retries a typed 4xx even on the first attempt', () => {
		const { retry } = queries(createQueryClient());
		expect(retry!(0, new ProblemError({ type: 'x', status: 404 }))).toBe(false);
	});

	it('honours a custom maxRetries', () => {
		const { retry } = queries(createQueryClient({ maxRetries: 1 }));
		const transient = new Error('network');
		expect(retry!(0, transient)).toBe(true);
		expect(retry!(1, transient)).toBe(false);
	});

	it('honours a custom staleTime', () => {
		expect(queries(createQueryClient({ staleTime: 5_000 })).staleTime).toBe(5_000);
	});
});

describe('createQueryClient — config merge precedence', () => {
	it('merges extra top-level config (e.g. mutations defaults)', () => {
		const client = createQueryClient({
			config: { defaultOptions: { mutations: { retry: 7 } } },
		});
		const defaults = client.getDefaultOptions();
		expect(defaults.mutations?.retry).toBe(7);
		// sveltesentio query defaults still present alongside the merged mutations.
		expect((defaults.queries as QueriesDefaults).staleTime).toBe(30_000);
	});

	it('lets caller-supplied queries defaults override the sveltesentio ones', () => {
		const client = createQueryClient({
			staleTime: 30_000,
			config: { defaultOptions: { queries: { staleTime: 1_234, gcTime: 99 } } },
		});
		const q = client.getDefaultOptions().queries as QueriesDefaults & { gcTime?: number };
		// caller's queries block is spread last in the wrapper -> it wins.
		expect(q.staleTime).toBe(1_234);
		expect(q.gcTime).toBe(99);
		// retry/retryDelay from sveltesentio survive the merge.
		expect(typeof q.retry).toBe('function');
	});
});
