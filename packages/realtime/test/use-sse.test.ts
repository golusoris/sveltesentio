import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventSourceLike } from '../src/sse-client.js';

/**
 * `.svelte.ts` rune modules need `$state` / `$effect` at runtime. The monorepo
 * runs vitest in `node`, so we install a minimal non-reactive shim before
 * importing the module under test (mirrors `rpc-use-connect-stream.test.ts`):
 * `$state(v)` returns `v`, and `$effect(fn)` runs the body immediately and
 * captures the teardown so the test can fire it (emulating `$effect` cleanup on
 * component unmount). Reactivity is not asserted — only the values read back
 * through the rune's getters, which re-read the closed-over `let` each access.
 */
const teardowns: Array<() => void> = [];
const g = globalThis as unknown as {
	$state?: unknown;
	$effect?: unknown;
};

beforeEach(() => {
	vi.useFakeTimers();
	FakeEventSource.instances = [];
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

type Listener = (event: unknown) => void;

/** Injected stand-in for the browser `EventSource`; tests drive its events. */
class FakeEventSource implements EventSourceLike {
	static instances: FakeEventSource[] = [];
	closed = false;
	url: string;
	init: { withCredentials?: boolean } | undefined;
	private readonly listeners = new Map<string, Set<Listener>>();

	constructor(url: string, init?: { withCredentials?: boolean }) {
		this.url = url;
		this.init = init;
		FakeEventSource.instances.push(this);
	}

	addEventListener(type: string, handler: Listener): void {
		if (!this.listeners.has(type)) this.listeners.set(type, new Set());
		this.listeners.get(type)!.add(handler);
	}

	removeEventListener(type: string, handler: Listener): void {
		this.listeners.get(type)?.delete(handler);
	}

	close(): void {
		this.closed = true;
	}

	listenerCount(type: string): number {
		return this.listeners.get(type)?.size ?? 0;
	}

	emit(type: string, payload?: unknown): void {
		for (const handler of this.listeners.get(type) ?? []) handler(payload);
	}
}

const factory = (url: string, init?: { withCredentials?: boolean }): FakeEventSource =>
	new FakeEventSource(url, init);

const latest = (): FakeEventSource => {
	const inst = FakeEventSource.instances.at(-1);
	if (!inst) throw new Error('no FakeEventSource instance created');
	return inst;
};

describe('useSSE', () => {
	it('auto-connects on mount and exposes idle->connecting->open lifecycle', async () => {
		const { useSSE } = await import('../src/use-sse.svelte.js');
		const rune = useSSE({ url: '/stream', eventSourceFactory: factory });

		// $effect ran synchronously via the shim -> start() -> connecting.
		expect(rune.state).toBe('connecting');
		expect(rune.connected).toBe(false);
		expect(FakeEventSource.instances).toHaveLength(1);
		expect(latest().url).toBe('/stream');

		latest().emit('open');
		expect(rune.state).toBe('open');
		expect(rune.connected).toBe(true);
		expect(rune.error).toBeUndefined();
	});

	it('does not connect when autoConnect is false until connect() is called', async () => {
		const { useSSE } = await import('../src/use-sse.svelte.js');
		const rune = useSSE({ url: '/s', autoConnect: false, eventSourceFactory: factory });

		expect(rune.state).toBe('idle');
		expect(FakeEventSource.instances).toHaveLength(0);

		rune.connect();
		expect(rune.state).toBe('connecting');
		expect(FakeEventSource.instances).toHaveLength(1);
	});

	it('accumulates messages and tracks lastMessage with normalised shape', async () => {
		const { useSSE } = await import('../src/use-sse.svelte.js');
		const rune = useSSE({ url: '/s', eventSourceFactory: factory });
		latest().emit('open');

		latest().emit('message', { type: 'message', data: 'one', lastEventId: '1' });
		latest().emit('message', { type: 'update', data: 'two' });

		expect(rune.messages.map((m) => m.data)).toEqual(['one', 'two']);
		expect(rune.lastMessage).toEqual({ type: 'update', data: 'two' });
		expect(rune.messages[0]).toEqual({ type: 'message', data: 'one', lastEventId: '1' });
	});

	it('caps retained history at historyLimit, dropping oldest first', async () => {
		const { useSSE } = await import('../src/use-sse.svelte.js');
		const rune = useSSE({ url: '/s', historyLimit: 3, eventSourceFactory: factory });
		latest().emit('open');

		for (let i = 0; i < 5; i += 1) {
			latest().emit('message', { type: 'message', data: String(i) });
		}

		expect(rune.messages.map((m) => m.data)).toEqual(['2', '3', '4']);
		expect(rune.lastMessage?.data).toBe('4');
	});

	it('batches messages through the buffered emitter when bufferMs > 0', async () => {
		const { useSSE } = await import('../src/use-sse.svelte.js');
		const rune = useSSE({ url: '/s', bufferMs: 50, eventSourceFactory: factory });
		latest().emit('open');

		latest().emit('message', { type: 'message', data: 'a' });
		latest().emit('message', { type: 'message', data: 'b' });
		// Not yet flushed — still inside the buffer window.
		expect(rune.messages).toEqual([]);
		expect(rune.lastMessage).toBeUndefined();

		vi.advanceTimersByTime(50);
		expect(rune.messages.map((m) => m.data)).toEqual(['a', 'b']);
		expect(rune.lastMessage?.data).toBe('b');
	});

	it('surfaces error and bumps attempt on transport error, then reconnects', async () => {
		const { useSSE } = await import('../src/use-sse.svelte.js');
		const rune = useSSE({
			url: '/s',
			backoff: { minMs: 1000, maxMs: 10_000, jitter: 0, base: 2, random: () => 0.5 },
			eventSourceFactory: factory,
		});
		latest().emit('open');
		expect(rune.error).toBeUndefined();

		const first = latest();
		const boom = new Error('boom');
		first.emit('error', boom);

		expect(rune.error).toBe(boom);
		// SseClient reports the pre-increment attempt to onError (0 on the first
		// failure); the internal counter increments only as it schedules the retry.
		expect(rune.attempt).toBe(0);
		// The errored source is torn down + state goes back to connecting.
		expect(first.closed).toBe(true);
		expect(rune.state).toBe('connecting');

		// Backoff fires -> a fresh source dials.
		vi.advanceTimersByTime(2000);
		expect(FakeEventSource.instances).toHaveLength(2);
	});

	it('clears a prior error when the connection (re)opens', async () => {
		const { useSSE } = await import('../src/use-sse.svelte.js');
		const rune = useSSE({
			url: '/s',
			backoff: { minMs: 500, maxMs: 10_000, jitter: 0, random: () => 0.5 },
			eventSourceFactory: factory,
		});
		// First error reports attempt 0 (pre-increment); the retry bumps the
		// internal counter to 1 and dials after the backoff window.
		latest().emit('error', new Error('first'));
		expect(rune.error).toBeInstanceOf(Error);
		expect(rune.attempt).toBe(0);

		// minMs 500, attempt 1 -> 500 * 2^1 = 1000ms backoff.
		vi.advanceTimersByTime(1000);
		// Second error on the retried source now reports the bumped attempt.
		latest().emit('error', new Error('second'));
		expect(rune.attempt).toBe(1);

		// Backoff for attempt 2 -> 500 * 2^2 = 2000ms, then a successful open.
		vi.advanceTimersByTime(2000);
		latest().emit('open');

		// onOpen clears the error; the rune's attempt counter is only written by
		// onError, so it retains the last reported value rather than resetting.
		expect(rune.error).toBeUndefined();
		expect(rune.attempt).toBe(1);
		expect(rune.connected).toBe(true);
	});

	it('close() stops reconnection and transitions to closed', async () => {
		const { useSSE } = await import('../src/use-sse.svelte.js');
		const rune = useSSE({
			url: '/s',
			backoff: { minMs: 500, maxMs: 10_000, jitter: 0, random: () => 0.5 },
			eventSourceFactory: factory,
		});
		latest().emit('error', new Error('err'));
		rune.close();

		expect(rune.state).toBe('closed');
		expect(rune.connected).toBe(false);
		// No reconnect dials after close, even past the backoff window.
		vi.advanceTimersByTime(5000);
		expect(FakeEventSource.instances).toHaveLength(1);
	});

	it('close() drops buffered messages so a late flush cannot leak', async () => {
		const { useSSE } = await import('../src/use-sse.svelte.js');
		const rune = useSSE({ url: '/s', bufferMs: 50, eventSourceFactory: factory });
		latest().emit('open');
		latest().emit('message', { type: 'message', data: 'pending' });

		rune.close();
		vi.advanceTimersByTime(100);

		expect(rune.messages).toEqual([]);
		expect(rune.lastMessage).toBeUndefined();
	});

	it('tears down the source and removes listeners on $effect cleanup (unmount)', async () => {
		const { useSSE } = await import('../src/use-sse.svelte.js');
		const rune = useSSE({ url: '/s', eventSourceFactory: factory });
		latest().emit('open');
		const source = latest();
		expect(source.listenerCount('message')).toBe(1);

		expect(teardowns).toHaveLength(1);
		teardowns[0]!();

		expect(source.closed).toBe(true);
		expect(source.listenerCount('message')).toBe(0);
		expect(source.listenerCount('open')).toBe(0);
		expect(source.listenerCount('error')).toBe(0);
		expect(rune.state).toBe('closed');
	});

	it('forwards withCredentials to the EventSource factory init', async () => {
		const { useSSE } = await import('../src/use-sse.svelte.js');
		useSSE({ url: '/s', withCredentials: true, eventSourceFactory: factory });
		expect(latest().init).toEqual({ withCredentials: true });
	});
});
