import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProblemError } from '@sveltesentio/core';
import { accessorFromCall, type SvelteQueryMock } from './_svelte-query-mock.js';

// Dynamic import inside the factory keeps `vi.mock` hoisting hoist-safe.
vi.mock('@tanstack/svelte-query', async () => {
	const { svelteQueryMockFactory } = await import('./_svelte-query-mock.js');
	return svelteQueryMockFactory();
});

const sq = (await import('@tanstack/svelte-query')) as unknown as SvelteQueryMock;
const { createSentioMutation, useOptimistic } = await import('../src/mutation.js');

interface ClientStub {
	invalidateQueries: ReturnType<typeof vi.fn>;
	cancelQueries: ReturnType<typeof vi.fn>;
	getQueryData: ReturnType<typeof vi.fn>;
	setQueryData: ReturnType<typeof vi.fn>;
}

function clientStub(): ClientStub {
	return {
		invalidateQueries: vi.fn(() => Promise.resolve()),
		cancelQueries: vi.fn(() => Promise.resolve()),
		getQueryData: vi.fn(),
		setQueryData: vi.fn(),
	};
}

let client: ClientStub;

beforeEach(() => {
	vi.clearAllMocks();
	client = clientStub();
	sq.useQueryClient.mockReturnValue(client);
});

describe('createSentioMutation — accessor + option shaping', () => {
	it('passes an Accessor<Options> to createMutation', () => {
		createSentioMutation<number, void>({ mutationFn: () => Promise.resolve(1) });
		expect(sq.createMutation).toHaveBeenCalledOnce();
		expect(typeof sq.createMutation.mock.calls[0]![0]).toBe('function');
	});

	it('forwards the mutationFn and does not leak `invalidates` into the options', () => {
		const mutationFn = vi.fn(() => Promise.resolve(1));
		createSentioMutation<number, void>({ mutationFn, invalidates: [['a']] });
		const opts = accessorFromCall(sq.createMutation)();
		expect(opts.mutationFn).toBe(mutationFn);
		expect('invalidates' in opts).toBe(false);
	});

	it('wraps onSettled and invalidates each listed key on settle', async () => {
		createSentioMutation<number, { name: string }>({
			mutationFn: () => Promise.resolve(1),
			invalidates: [['a'], ['b', 2]],
		});
		const opts = accessorFromCall<{
			onSettled: (
				data: unknown,
				error: unknown,
				vars: unknown,
				ctx: unknown,
				m: unknown,
			) => unknown;
		}>(sq.createMutation)();

		// svelte-query v6 calls onSettled with 5 args: (data, error, vars, ctx, mutation).
		await opts.onSettled(1, null, { name: 'x' }, undefined, {});
		expect(client.invalidateQueries).toHaveBeenCalledTimes(2);
		expect(client.invalidateQueries).toHaveBeenNthCalledWith(1, { queryKey: ['a'] });
		expect(client.invalidateQueries).toHaveBeenNthCalledWith(2, { queryKey: ['b', 2] });
	});

	it('still calls a caller-provided onSettled (with all 5 args) after invalidating', async () => {
		const onSettled = vi.fn(() => 'done');
		createSentioMutation<number, { name: string }, { trace: string }>({
			mutationFn: () => Promise.resolve(1),
			invalidates: [['a']],
			onSettled,
		});
		const opts = accessorFromCall<{
			onSettled: (
				data: unknown,
				error: unknown,
				vars: unknown,
				ctx: unknown,
				m: unknown,
			) => unknown;
		}>(sq.createMutation)();

		const err = new ProblemError({ type: 'x', status: 500 });
		const result = await opts.onSettled(undefined, err, { name: 'y' }, { trace: 't' }, {});
		expect(client.invalidateQueries).toHaveBeenCalledOnce();
		expect(onSettled).toHaveBeenCalledWith(undefined, err, { name: 'y' }, { trace: 't' }, {});
		expect(result).toBe('done');
	});

	it('onSettled is a no-op for invalidation when no `invalidates` given', async () => {
		createSentioMutation<number, void>({ mutationFn: () => Promise.resolve(1) });
		const opts = accessorFromCall<{
			onSettled: (...a: unknown[]) => unknown;
		}>(sq.createMutation)();
		await opts.onSettled(1, null, undefined, undefined, {});
		expect(client.invalidateQueries).not.toHaveBeenCalled();
	});
});

describe('useOptimistic — RFC 9457 snapshot / apply / rollback', () => {
	type Snap = { items: string[] };

	function build() {
		useOptimistic<Snap, string, Snap>({
			queryKey: ['list'],
			mutationFn: () => Promise.resolve({ items: [] }),
			optimisticUpdate: (prev, variable) => ({
				items: [...(prev?.items ?? []), variable],
			}),
		});
		return accessorFromCall<{
			onMutate: (v: string) => Promise<{ previous: Snap | undefined }>;
			onError: (e: unknown, v: string, ctx?: { previous: Snap | undefined }) => void;
			onSettled: () => void;
		}>(sq.createMutation)();
	}

	it('onMutate cancels in-flight queries, snapshots, and applies the optimistic value', async () => {
		client.getQueryData.mockReturnValue({ items: ['existing'] });
		const opts = build();

		const ctx = await opts.onMutate('new');
		expect(client.cancelQueries).toHaveBeenCalledWith({ queryKey: ['list'] });
		expect(ctx).toEqual({ previous: { items: ['existing'] } });
		expect(client.setQueryData).toHaveBeenCalledWith(['list'], { items: ['existing', 'new'] });
	});

	it('optimisticUpdate handles an empty cache (previous === undefined)', async () => {
		client.getQueryData.mockReturnValue(undefined);
		const opts = build();
		const ctx = await opts.onMutate('first');
		expect(ctx).toEqual({ previous: undefined });
		expect(client.setQueryData).toHaveBeenCalledWith(['list'], { items: ['first'] });
	});

	it('onError restores the snapshot from context', () => {
		const opts = build();
		opts.onError(new ProblemError({ type: 'x', status: 500 }), 'new', {
			previous: { items: ['existing'] },
		});
		expect(client.setQueryData).toHaveBeenCalledWith(['list'], { items: ['existing'] });
	});

	it('onError without context does not touch the cache', () => {
		const opts = build();
		opts.onError(new Error('boom'), 'new', undefined);
		expect(client.setQueryData).not.toHaveBeenCalled();
	});

	it('onSettled reconciles by invalidating the key when invalidateOnSettled defaults true', () => {
		const opts = build();
		opts.onSettled();
		expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['list'] });
	});

	it('onSettled skips invalidation when invalidateOnSettled is false', () => {
		useOptimistic<Snap, string, Snap>({
			queryKey: ['list'],
			mutationFn: () => Promise.resolve({ items: [] }),
			optimisticUpdate: (prev) => prev ?? { items: [] },
			invalidateOnSettled: false,
		});
		const opts = accessorFromCall<{ onSettled: () => void }>(sq.createMutation)();
		opts.onSettled();
		expect(client.invalidateQueries).not.toHaveBeenCalled();
	});
});
