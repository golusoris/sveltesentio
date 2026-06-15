import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests the transport-agnostic `src/use-connect-stream.svelte.ts` rune (the
 * `./use-connect-stream` export) — distinct from `src/rpc/...`, which has its
 * own suite. Same `$state` / `$effect` shim as the rpc rune test: `$state(v)`
 * returns `v` and `$effect(fn)` runs the body immediately, capturing the
 * teardown so the test can fire it to emulate component unmount. The injected
 * `call` seam takes an `AbortSignal` and returns a manually-driven async
 * iterable, so no network / grpc / runes runtime is needed.
 */
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

const flush = (): Promise<void> => Promise.resolve().then(() => Promise.resolve());

/** Manually-driven async iterable mirroring the connect-stream test's fake. */
function createFakeStream<T>() {
	let resolveNext: ((r: IteratorResult<T>) => void) | undefined;
	let rejectNext: ((e: unknown) => void) | undefined;
	const queue: IteratorResult<T>[] = [];

	const iterable: AsyncIterable<T> = {
		[Symbol.asyncIterator](): AsyncIterator<T> {
			return {
				next(): Promise<IteratorResult<T>> {
					const queued = queue.shift();
					if (queued) return Promise.resolve(queued);
					return new Promise<IteratorResult<T>>((resolve, reject) => {
						resolveNext = resolve;
						rejectNext = reject;
					});
				},
			};
		},
	};

	return {
		iterable,
		emit(value: T): void {
			if (resolveNext) {
				const r = resolveNext;
				resolveNext = undefined;
				rejectNext = undefined;
				r({ value, done: false });
			} else {
				queue.push({ value, done: false });
			}
		},
		complete(): void {
			if (resolveNext) {
				const r = resolveNext;
				resolveNext = undefined;
				rejectNext = undefined;
				r({ value: undefined as never, done: true });
			} else {
				queue.push({ value: undefined as never, done: true });
			}
		},
		fail(error: unknown): void {
			if (rejectNext) {
				const r = rejectNext;
				resolveNext = undefined;
				rejectNext = undefined;
				r(error);
			}
		},
	};
}

type Msg = { body: string };

describe('useConnectStream (transport-agnostic rune)', () => {
	it('auto-starts on mount: idle->streaming and accumulates messages', async () => {
		const { useConnectStream } = await import('../src/use-connect-stream.svelte.js');
		const fake = createFakeStream<Msg>();
		const rune = useConnectStream<Msg>({ call: () => fake.iterable });

		expect(rune.state).toBe('streaming');
		expect(rune.streaming).toBe(true);
		expect(rune.messages).toEqual([]);

		fake.emit({ body: 'a' });
		await flush();
		fake.emit({ body: 'b' });
		await flush();

		expect(rune.messages.map((m) => m.body)).toEqual(['a', 'b']);
		expect(rune.lastMessage).toEqual({ body: 'b' });
		expect(rune.error).toBeUndefined();
	});

	it('does not start when autoStart is false until start() is called', async () => {
		const { useConnectStream } = await import('../src/use-connect-stream.svelte.js');
		let opened = 0;
		const fake = createFakeStream<Msg>();
		const rune = useConnectStream<Msg>({
			autoStart: false,
			call: () => {
				opened += 1;
				return fake.iterable;
			},
		});

		expect(rune.state).toBe('idle');
		expect(rune.streaming).toBe(false);
		expect(opened).toBe(0);

		rune.start();
		expect(rune.state).toBe('streaming');
		expect(opened).toBe(1);
	});

	it('reaches closed state on natural stream completion', async () => {
		const { useConnectStream } = await import('../src/use-connect-stream.svelte.js');
		const fake = createFakeStream<Msg>();
		const rune = useConnectStream<Msg>({ call: () => fake.iterable });

		fake.emit({ body: 'only' });
		await flush();
		fake.complete();
		await flush();

		expect(rune.state).toBe('closed');
		expect(rune.streaming).toBe(false);
		expect(rune.messages).toHaveLength(1);
	});

	it('caps retained history at historyLimit, dropping oldest first', async () => {
		const { useConnectStream } = await import('../src/use-connect-stream.svelte.js');
		const fake = createFakeStream<Msg>();
		const rune = useConnectStream<Msg>({ historyLimit: 2, call: () => fake.iterable });

		for (let i = 0; i < 4; i += 1) {
			fake.emit({ body: String(i) });
			await flush();
		}

		expect(rune.messages.map((m) => m.body)).toEqual(['2', '3']);
		expect(rune.lastMessage?.body).toBe('3');
	});

	it('batches messages through the buffered emitter when bufferMs > 0', async () => {
		const { useConnectStream } = await import('../src/use-connect-stream.svelte.js');
		const fake = createFakeStream<Msg>();
		const rune = useConnectStream<Msg>({ bufferMs: 50, call: () => fake.iterable });

		fake.emit({ body: 'a' });
		await flush();
		fake.emit({ body: 'b' });
		await flush();
		// Buffered: nothing reactive yet.
		expect(rune.messages).toEqual([]);
		expect(rune.lastMessage).toBeUndefined();

		vi.advanceTimersByTime(50);
		expect(rune.messages.map((m) => m.body)).toEqual(['a', 'b']);
		expect(rune.lastMessage?.body).toBe('b');
	});

	it('surfaces an error and bumps attempt on a thrown stream, then reconnects', async () => {
		const { useConnectStream } = await import('../src/use-connect-stream.svelte.js');
		let opened = 0;
		const fakes: ReturnType<typeof createFakeStream<Msg>>[] = [];
		const rune = useConnectStream<Msg>({
			backoff: { minMs: 1000, maxMs: 10_000, jitter: 0, base: 2, random: () => 0.5 },
			call: () => {
				opened += 1;
				const fake = createFakeStream<Msg>();
				fakes.push(fake);
				return fake.iterable;
			},
		});

		expect(opened).toBe(1);
		fakes[0]!.fail(new Error('boom'));
		await flush();

		expect(rune.error).toBeInstanceOf(Error);
		expect((rune.error as Error).message).toBe('boom');
		expect(rune.attempt).toBe(1);
		// State stays streaming across a scheduled reconnect.
		expect(rune.state).toBe('streaming');

		vi.advanceTimersByTime(2000);
		expect(opened).toBe(2);
	});

	it('clears a prior error once the next message arrives after reconnect', async () => {
		const { useConnectStream } = await import('../src/use-connect-stream.svelte.js');
		const fakes: ReturnType<typeof createFakeStream<Msg>>[] = [];
		const rune = useConnectStream<Msg>({
			backoff: { minMs: 1000, maxMs: 10_000, jitter: 0, random: () => 0.5 },
			call: () => {
				const fake = createFakeStream<Msg>();
				fakes.push(fake);
				return fake.iterable;
			},
		});

		fakes[0]!.fail(new Error('transient'));
		await flush();
		expect(rune.error).toBeInstanceOf(Error);
		expect(rune.attempt).toBe(1);

		// minMs 1000, attempt 1 -> 1000 * 2^1 = 2000ms backoff before the redial.
		vi.advanceTimersByTime(2000);
		fakes[1]!.emit({ body: 'recovered' });
		await flush();

		expect(rune.error).toBeUndefined();
		expect(rune.attempt).toBe(0);
		expect(rune.lastMessage?.body).toBe('recovered');
	});

	it('stop() aborts the active stream and transitions to closed', async () => {
		const { useConnectStream } = await import('../src/use-connect-stream.svelte.js');
		const fake = createFakeStream<Msg>();
		let signalSeen: AbortSignal | undefined;
		const rune = useConnectStream<Msg>({
			call: (signal) => {
				signalSeen = signal;
				return fake.iterable;
			},
		});

		expect(rune.state).toBe('streaming');
		expect(signalSeen).toBeInstanceOf(AbortSignal);
		expect(signalSeen!.aborted).toBe(false);

		rune.stop();
		expect(rune.state).toBe('closed');
		expect(rune.streaming).toBe(false);
		expect(signalSeen!.aborted).toBe(true);
	});

	it('tears down on $effect cleanup (unmount): aborts + closes', async () => {
		const { useConnectStream } = await import('../src/use-connect-stream.svelte.js');
		const fake = createFakeStream<Msg>();
		let signalSeen: AbortSignal | undefined;
		const rune = useConnectStream<Msg>({
			call: (signal) => {
				signalSeen = signal;
				return fake.iterable;
			},
		});

		expect(teardowns).toHaveLength(1);
		teardowns[0]!();

		expect(rune.state).toBe('closed');
		expect(signalSeen!.aborted).toBe(true);
	});

	it('stop() drops buffered messages so a late flush cannot leak', async () => {
		const { useConnectStream } = await import('../src/use-connect-stream.svelte.js');
		const fake = createFakeStream<Msg>();
		const rune = useConnectStream<Msg>({ bufferMs: 50, call: () => fake.iterable });

		fake.emit({ body: 'pending' });
		await flush();
		rune.stop();
		vi.advanceTimersByTime(100);

		expect(rune.messages).toEqual([]);
		expect(rune.lastMessage).toBeUndefined();
	});
});
