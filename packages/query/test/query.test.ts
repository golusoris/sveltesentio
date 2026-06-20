import { describe, it, expect, vi, beforeEach } from 'vitest';
import { accessorFromCall, type SvelteQueryMock } from './_svelte-query-mock.js';

// Dynamic import inside the factory keeps `vi.mock` hoisting hoist-safe.
vi.mock('@tanstack/svelte-query', async () => {
	const { svelteQueryMockFactory } = await import('./_svelte-query-mock.js');
	return svelteQueryMockFactory();
});

const sq = (await import('@tanstack/svelte-query')) as unknown as SvelteQueryMock;
const { createSentioQuery, createQueryInvalidator } = await import('../src/query.js');

beforeEach(() => {
	vi.clearAllMocks();
});

describe('createSentioQuery — accessor-options shape (svelte-query v6)', () => {
	it('passes an Accessor<Options> (a function returning the options)', () => {
		createSentioQuery<{ id: number }>({
			queryKey: ['user', 1],
			queryFn: () => Promise.resolve({ id: 1 }),
		});
		expect(sq.createQuery).toHaveBeenCalledOnce();
		// v6 requires `() => ({...})`, not a plain options object.
		expect(typeof sq.createQuery.mock.calls[0]![0]).toBe('function');
	});

	it('shapes the options with a 30s stale-time default and the passed key/fn', () => {
		const queryFn = vi.fn(() => Promise.resolve(7));
		createSentioQuery<number>({ queryKey: ['count'], queryFn });
		const opts = accessorFromCall(sq.createQuery)();
		expect(opts.staleTime).toBe(30_000);
		expect(opts.queryKey).toEqual(['count']);
		expect(opts.queryFn).toBe(queryFn);
	});

	it('lets the caller override the default stale-time (options spread last)', () => {
		createSentioQuery<number>({
			queryKey: ['k'],
			queryFn: () => Promise.resolve(0),
			staleTime: 0,
		});
		expect(accessorFromCall(sq.createQuery)().staleTime).toBe(0);
	});

	it('forwards extra TanStack options (enabled, refetchOnWindowFocus)', () => {
		createSentioQuery<number>({
			queryKey: ['k'],
			queryFn: () => Promise.resolve(0),
			enabled: false,
			refetchOnWindowFocus: false,
		});
		const opts = accessorFromCall(sq.createQuery)();
		expect(opts.enabled).toBe(false);
		expect(opts.refetchOnWindowFocus).toBe(false);
	});

	it('produces a fresh options object each accessor invocation (no shared mutation)', () => {
		createSentioQuery<number>({ queryKey: ['k'], queryFn: () => Promise.resolve(0) });
		const accessor = accessorFromCall(sq.createQuery);
		expect(accessor()).not.toBe(accessor());
		expect(accessor()).toEqual(accessor());
	});
});

describe('createSentioQuery — reactive (accessor) options form (issue #176)', () => {
	it('accepts a function form and re-reads it on every accessor invocation', () => {
		let sortBy = 'added';
		createSentioQuery<number>(() => ({
			queryKey: ['movies', 'list', sortBy],
			queryFn: () => Promise.resolve(0),
		}));
		const accessor = accessorFromCall(sq.createQuery);
		expect(accessor().queryKey).toEqual(['movies', 'list', 'added']);
		// A reactive key (derived from $state) must be re-read so TanStack refetches.
		sortBy = 'title';
		expect(accessor().queryKey).toEqual(['movies', 'list', 'title']);
	});

	it('still applies the 30s stale-time default in the function form', () => {
		createSentioQuery<number>(() => ({ queryKey: ['k'], queryFn: () => Promise.resolve(0) }));
		expect(accessorFromCall(sq.createQuery)().staleTime).toBe(30_000);
	});
});

describe('createQueryInvalidator', () => {
	it('resolves the active client via useQueryClient and invalidates by key', async () => {
		const invalidateQueries = vi.fn(() => Promise.resolve());
		sq.useQueryClient.mockReturnValue({ invalidateQueries });

		const invalidate = createQueryInvalidator();
		expect(sq.useQueryClient).toHaveBeenCalledOnce();

		await invalidate(['items']);
		expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['items'] });
	});
});
