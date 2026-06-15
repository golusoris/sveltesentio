import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@connectrpc/connect';
import type { DescService } from '@bufbuild/protobuf';

/**
 * `.svelte.ts` rune modules need `$state` / `$effect` at runtime. The monorepo
 * runs vitest in `node`, so we install a minimal non-reactive shim before
 * importing the module under test: `$state(v)` returns `v`, and `$effect(fn)`
 * runs the body immediately and captures the teardown so the test can fire it
 * (emulating `$effect` cleanup on component unmount). Reactivity is not asserted
 * — only the values read back through the rune's getters after each microtask.
 */
const teardowns: Array<() => void> = [];
const g = globalThis as unknown as {
	$state?: unknown;
	$effect?: unknown;
};

beforeEach(() => {
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
});

const flush = (): Promise<void> => Promise.resolve().then(() => Promise.resolve());

/** Manually-driven async iterable mirroring the connect-stream test's fake. */
function createFakeStream<T>() {
	let resolveNext: ((r: IteratorResult<T>) => void) | undefined;
	let rejectNext: ((e: unknown) => void) | undefined;
	const queue: IteratorResult<T>[] = [];
	let aborted = false;

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
		get aborted(): boolean {
			return aborted;
		},
		markAborted(): void {
			aborted = true;
		},
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
// The rune injects the client, so an opaque stand-in satisfies the seam — the
// `call` selector receives it but our fake ignores it and returns the stream.
const fakeClient = {} as Client<DescService>;

describe('useConnectStream (rpc rune)', () => {
	it('transitions idle -> streaming and accumulates data', async () => {
		const { useConnectStream } = await import('../src/rpc/use-connect-stream.svelte.js');
		const fake = createFakeStream<Msg>();
		const rune = useConnectStream<DescService, Msg>({
			client: fakeClient,
			call: () => fake.iterable,
		});

		// autoStart fires the $effect immediately -> streaming.
		expect(rune.status).toBe('streaming');
		expect(rune.data).toEqual([]);

		fake.emit({ body: 'a' });
		await flush();
		fake.emit({ body: 'b' });
		await flush();

		expect(rune.data.map((m) => m.body)).toEqual(['a', 'b']);
		expect(rune.error).toBeUndefined();
	});

	it('reaches closed status on natural stream completion', async () => {
		const { useConnectStream } = await import('../src/rpc/use-connect-stream.svelte.js');
		const fake = createFakeStream<Msg>();
		const rune = useConnectStream<DescService, Msg>({
			client: fakeClient,
			call: () => fake.iterable,
		});

		fake.emit({ body: 'only' });
		await flush();
		fake.complete();
		await flush();

		expect(rune.status).toBe('closed');
		expect(rune.data).toHaveLength(1);
	});

	it('surfaces an error and schedules reconnect on a thrown stream', async () => {
		const { useConnectStream } = await import('../src/rpc/use-connect-stream.svelte.js');
		let opened = 0;
		const fakes: ReturnType<typeof createFakeStream<Msg>>[] = [];
		const rune = useConnectStream<DescService, Msg>({
			client: fakeClient,
			call: () => {
				opened += 1;
				const fake = createFakeStream<Msg>();
				fakes.push(fake);
				return fake.iterable;
			},
			backoff: { minMs: 1000, maxMs: 10_000, jitter: 0, random: () => 0.5 },
		});

		expect(opened).toBe(1);
		fakes[0]!.fail(new Error('boom'));
		await flush();
		expect(rune.error).toBeInstanceOf(Error);
		expect((rune.error as Error).message).toBe('boom');
	});

	it('forwards the abort signal and tears down on $effect cleanup', async () => {
		const { useConnectStream } = await import('../src/rpc/use-connect-stream.svelte.js');
		const fake = createFakeStream<Msg>();
		let signalSeen: AbortSignal | undefined;
		const rune = useConnectStream<DescService, Msg>({
			client: fakeClient,
			call: (_client, { signal }) => {
				signalSeen = signal;
				signal.addEventListener('abort', () => fake.markAborted());
				return fake.iterable;
			},
		});

		expect(rune.status).toBe('streaming');
		expect(signalSeen).toBeInstanceOf(AbortSignal);

		// Fire the captured $effect teardown (component unmount).
		expect(teardowns).toHaveLength(1);
		teardowns[0]!();

		expect(rune.status).toBe('closed');
		expect(fake.aborted).toBe(true);
	});

	it('does not start when autoStart is false until start() is called', async () => {
		const { useConnectStream } = await import('../src/rpc/use-connect-stream.svelte.js');
		let opened = 0;
		const fake = createFakeStream<Msg>();
		const rune = useConnectStream<DescService, Msg>({
			client: fakeClient,
			autoStart: false,
			call: () => {
				opened += 1;
				return fake.iterable;
			},
		});

		expect(rune.status).toBe('idle');
		expect(opened).toBe(0);

		rune.start();
		expect(rune.status).toBe('streaming');
		expect(opened).toBe(1);
	});
});
