import { ProblemError } from '@sveltesentio/core';
import { describe, expect, it, vi } from 'vitest';
import { createPendingQueue } from '../src/pending-queue.js';

const problem = (title: string): ProblemError =>
	new ProblemError({ type: 'https://example.test/p', title, detail: title });

const bytes = (n: number): Uint8Array => new Uint8Array([n]);

/** Registers a request and exposes how it settled, without a socket. */
function enqueue(queue: ReturnType<typeof createPendingQueue>, timeoutMs?: number) {
	const settled: { payload?: Uint8Array; error?: ProblemError; timedOut?: boolean } = {};
	const handle = queue.add(
		{
			resolve: (payload) => {
				settled.payload = payload;
			},
			reject: (error) => {
				settled.error = error;
			},
		},
		timeoutMs,
		() => {
			settled.timedOut = true;
		},
	);
	return { handle, settled };
}

describe('createPendingQueue', () => {
	it('settles requests in the order they were registered', () => {
		const queue = createPendingQueue();
		const first = enqueue(queue);
		const second = enqueue(queue);

		queue.settleNext(bytes(1));
		queue.settleNext(bytes(2));

		expect(first.settled.payload).toEqual(bytes(1));
		expect(second.settled.payload).toEqual(bytes(2));
		expect(queue.size).toBe(0);
	});

	// Negative: a response with nobody waiting is dropped, not thrown on. The
	// peer sending an extra frame must not take the client down.
	it('drops a response that nobody is waiting for', () => {
		const queue = createPendingQueue();
		expect(() => queue.settleNext(bytes(9))).not.toThrow();
		expect(queue.size).toBe(0);
	});

	it('rejects every waiter on failAll and records the failure', () => {
		const queue = createPendingQueue();
		const first = enqueue(queue);
		const second = enqueue(queue);
		const error = problem('socket died');

		queue.failAll(error);

		expect(first.settled.error).toBe(error);
		expect(second.settled.error).toBe(error);
		expect(queue.failure).toBe(error);
		expect(queue.size).toBe(0);
	});

	it('reports no failure before one happens', () => {
		expect(createPendingQueue().failure).toBeUndefined();
	});

	it('times a request out and removes it', () => {
		vi.useFakeTimers();
		try {
			const queue = createPendingQueue();
			const { settled } = enqueue(queue, 50);

			vi.advanceTimersByTime(50);

			expect(settled.timedOut).toBe(true);
			expect(queue.size).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	// This is the bug the inline version invited: a settled request whose timer
	// still fires would reject a promise that already resolved.
	it('does not fire the timeout of a request that already settled', () => {
		vi.useFakeTimers();
		try {
			const queue = createPendingQueue();
			const { settled } = enqueue(queue, 50);

			queue.settleNext(bytes(7));
			vi.advanceTimersByTime(500);

			expect(settled.payload).toEqual(bytes(7));
			expect(settled.timedOut).toBeUndefined();
		} finally {
			vi.useRealTimers();
		}
	});

	it('does not fire the timeout of a request failAll already rejected', () => {
		vi.useFakeTimers();
		try {
			const queue = createPendingQueue();
			const { settled } = enqueue(queue, 50);

			queue.failAll(problem('gone'));
			vi.advanceTimersByTime(500);

			expect(settled.error?.title).toBe('gone');
			expect(settled.timedOut).toBeUndefined();
		} finally {
			vi.useRealTimers();
		}
	});

	it('withdraws a request whose write failed, so it never settles', () => {
		vi.useFakeTimers();
		try {
			const queue = createPendingQueue();
			const { handle, settled } = enqueue(queue, 50);

			handle.cancel();
			vi.advanceTimersByTime(500);
			queue.settleNext(bytes(3));

			expect(queue.size).toBe(0);
			expect(settled.payload).toBeUndefined();
			expect(settled.timedOut).toBeUndefined();
		} finally {
			vi.useRealTimers();
		}
	});

	// Boundary: cancelling twice, and cancelling something already settled, are
	// both no-ops rather than errors.
	it('tolerates cancel being called twice or after settling', () => {
		const queue = createPendingQueue();
		const { handle } = enqueue(queue);

		handle.cancel();
		expect(() => handle.cancel()).not.toThrow();

		const second = enqueue(queue);
		queue.settleNext(bytes(1));
		expect(() => second.handle.cancel()).not.toThrow();
	});
});
