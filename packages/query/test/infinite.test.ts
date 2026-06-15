import { describe, it, expect, vi, beforeEach } from 'vitest';
import { accessorFromCall, type SvelteQueryMock } from './_svelte-query-mock.js';

// Dynamic import inside the factory keeps `vi.mock` hoisting hoist-safe.
vi.mock('@tanstack/svelte-query', async () => {
	const { svelteQueryMockFactory } = await import('./_svelte-query-mock.js');
	return svelteQueryMockFactory();
});

const sq = (await import('@tanstack/svelte-query')) as unknown as SvelteQueryMock;
const { createInfiniteItems, flattenPages } = await import('../src/infinite.js');

interface PagedResponse<T> {
	items: T[];
	nextCursor: string | null;
	total?: number;
}

interface InfiniteOpts<T> {
	staleTime?: number;
	initialPageParam: string | null;
	getNextPageParam: (last: PagedResponse<T>) => string | null;
	queryFn: (ctx: { pageParam: string | null }) => Promise<PagedResponse<T>>;
	queryKey?: unknown;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('createInfiniteItems — cursor pagination preset', () => {
	it('passes an Accessor<Options> to createInfiniteQuery', () => {
		createInfiniteItems<string>({
			queryKey: ['feed'],
			queryFn: () => Promise.resolve({ items: [], nextCursor: null }),
		});
		expect(sq.createInfiniteQuery).toHaveBeenCalledOnce();
		expect(typeof sq.createInfiniteQuery.mock.calls[0]![0]).toBe('function');
	});

	it('defaults initialPageParam to null and stale-time to 30s', () => {
		createInfiniteItems<string>({
			queryKey: ['feed'],
			queryFn: () => Promise.resolve({ items: [], nextCursor: null }),
		});
		const opts = accessorFromCall<InfiniteOpts<string>>(sq.createInfiniteQuery)();
		expect(opts.initialPageParam).toBeNull();
		expect(opts.staleTime).toBe(30_000);
	});

	it('honours a custom initialCursor', () => {
		createInfiniteItems<string>({
			queryKey: ['feed'],
			initialCursor: 'cursor-7',
			queryFn: () => Promise.resolve({ items: [], nextCursor: null }),
		});
		expect(
			accessorFromCall<InfiniteOpts<string>>(sq.createInfiniteQuery)().initialPageParam,
		).toBe('cursor-7');
	});

	it('getNextPageParam returns the page cursor, and null on the last page', () => {
		createInfiniteItems<string>({
			queryKey: ['feed'],
			queryFn: () => Promise.resolve({ items: [], nextCursor: null }),
		});
		const { getNextPageParam } = accessorFromCall<InfiniteOpts<string>>(sq.createInfiniteQuery)();
		expect(getNextPageParam({ items: ['a'], nextCursor: 'c2' })).toBe('c2');
		expect(getNextPageParam({ items: ['z'], nextCursor: null })).toBeNull();
	});

	it('adapts the TanStack queryFn context to the cursor-only resolver', async () => {
		const queryFn = vi.fn((cursor: string | null) =>
			Promise.resolve({ items: [`@${cursor}`], nextCursor: null }),
		);
		createInfiniteItems<string>({ queryKey: ['feed'], queryFn });
		const opts = accessorFromCall<InfiniteOpts<string>>(sq.createInfiniteQuery)();

		const page = await opts.queryFn({ pageParam: 'c5' });
		// resolver is invoked with the unwrapped cursor, not the ctx object.
		expect(queryFn).toHaveBeenCalledWith('c5');
		expect(page.items).toEqual(['@c5']);
	});

	it('does not leak the bare `queryFn`/`initialCursor` wrapper inputs unshaped', () => {
		const queryFn = vi.fn(() => Promise.resolve({ items: [], nextCursor: null }));
		createInfiniteItems<string>({ queryKey: ['feed'], initialCursor: 'x', queryFn });
		const opts = accessorFromCall<InfiniteOpts<string> & Record<string, unknown>>(
			sq.createInfiniteQuery,
		)();
		// initialCursor is consumed and re-expressed as initialPageParam.
		expect('initialCursor' in opts).toBe(false);
		// the queryFn handed to TanStack is the cursor-adapting wrapper, not the raw resolver.
		expect(opts.queryFn).not.toBe(queryFn);
	});
});

describe('flattenPages', () => {
	it('returns an empty array for undefined data', () => {
		expect(flattenPages<string>(undefined)).toEqual([]);
	});

	it('flattens items across pages in order', () => {
		const data = {
			pages: [
				{ items: ['a', 'b'], nextCursor: 'c1' },
				{ items: ['c'], nextCursor: null },
			],
			pageParams: [null, 'c1'],
		};
		expect(flattenPages<string>(data)).toEqual(['a', 'b', 'c']);
	});

	it('handles pages with empty item arrays', () => {
		const data = {
			pages: [
				{ items: [], nextCursor: 'c1' },
				{ items: ['only'], nextCursor: null },
			],
			pageParams: [null, 'c1'],
		};
		expect(flattenPages<string>(data)).toEqual(['only']);
	});
});
