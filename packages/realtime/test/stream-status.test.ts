import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachStreamStatus, createStreamStatus } from '../src/stream-status.svelte.js';

const teardowns: Array<() => void> = [];
const g = globalThis as unknown as {
	$state?: unknown;
	$effect?: unknown;
};

beforeEach(() => {
	vi.useFakeTimers();
	g.$state = <T>(initial: T): T => initial;
	const effect = (fn: () => void | (() => void)): void => {
		const cleanup = fn();
		if (typeof cleanup === 'function') teardowns.push(cleanup);
	};
	g.$effect = effect;
});

afterEach(() => {
	teardowns.length = 0;
	delete g.$state;
	delete g.$effect;
	vi.useRealTimers();
});

describe('createStreamStatus', () => {
	// Positive: core lifecycle transitions and message buffering.
	it('initializes with given state, zero attempt, and undefined error/lastMessage', () => {
		const status = createStreamStatus<'idle' | 'open', string>('idle', 10, 0);
		expect(status.state).toBe('idle');
		expect(status.attempt).toBe(0);
		expect(status.error).toBeUndefined();
		expect(status.lastMessage).toBeUndefined();
		expect(status.messages).toEqual([]);
	});

	it('updates state on onStateChange', () => {
		const status = createStreamStatus<'idle' | 'open', string>('idle', 10, 0);
		status.onStateChange('open');
		expect(status.state).toBe('open');
	});

	it('records and clears errors and reconnect attempts', () => {
		const status = createStreamStatus<'idle' | 'open', string>('idle', 10, 0);
		const err = new Error('network failure');
		status.onError(err, 3);
		expect(status.error).toBe(err);
		expect(status.attempt).toBe(3);

		status.resetError();
		expect(status.error).toBeUndefined();
		expect(status.attempt).toBe(3);

		status.resetAttempt();
		expect(status.attempt).toBe(0);
	});

	it('buffers messages up to historyLimit and exposes lastMessage', () => {
		const status = createStreamStatus<'idle' | 'open', string>('idle', 2, 0);
		status.push('first');
		expect(status.lastMessage).toBe('first');
		expect(status.messages).toEqual(['first']);

		status.push('second');
		status.push('third');
		expect(status.lastMessage).toBe('third');
		expect(status.messages).toEqual(['second', 'third']);
	});

	it('stops throttled buffer when stop is called', () => {
		const status = createStreamStatus<'idle' | 'open', string>('idle', 10, 50);
		status.push('queued');
		status.stop();
		vi.advanceTimersByTime(100);
		expect(status.messages).toEqual([]);
	});

	// Boundary: attached getters reflect live mutations without spread pitfall.
	it('attaches live reactive getters to a target object', () => {
		const status = createStreamStatus<'idle' | 'open', string>('idle', 10, 0);
		const target = { custom: 42 };
		const attached = status.attach(target);

		expect(attached.custom).toBe(42);
		expect(attached.state).toBe('idle');

		status.onStateChange('open');
		expect(attached.state).toBe('open');

		status.push('hello');
		expect(attached.lastMessage).toBe('hello');
		expect(attached.messages).toEqual(['hello']);

		status.onError('fail', 1);
		expect(attached.error).toBe('fail');
		expect(attached.attempt).toBe(1);
	});

	// Negative: boundary and no-op mutation handling.
	it('handles resetError and resetAttempt when already in initial state', () => {
		const status = createStreamStatus<'idle' | 'open', string>('idle', 0, 0);
		status.resetError();
		status.resetAttempt();
		expect(status.error).toBeUndefined();
		expect(status.attempt).toBe(0);
		status.push('dropped');
		expect(status.messages).toEqual([]);
	});
});

describe('attachStreamStatus', () => {
	it('returns the same target object with property descriptors defined', () => {
		const status = createStreamStatus<'idle' | 'open', string>('idle', 10, 0);
		const target = {};
		const result = attachStreamStatus(target, status);
		expect(result).toBe(target);
	});

	it('exposes live getters that track later status changes', () => {
		const status = createStreamStatus<'idle' | 'open', string>('idle', 10, 0);
		const result = attachStreamStatus({ extra: 1 }, status);
		expect(result.state).toBe('idle');
		status.onStateChange('open');
		status.onError('boom', 2);
		status.push('m1');
		expect(result.state).toBe('open');
		expect(result.error).toBe('boom');
		expect(result.attempt).toBe(2);
		expect(result.lastMessage).toBe('m1');
		expect(result.messages).toEqual(['m1']);
		expect(result.extra).toBe(1);
	});
});
