import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createConnectStream,
	type ConnectStreamState,
	type StreamCall,
} from '../src/connect-stream.js';

/**
 * A manually-driven async iterable: tests push messages / errors / completion
 * and the consumer pulls them. Mirrors the `FakeEventSource` injection pattern
 * used by the SSE client tests — no network, no grpc.
 */
function createFakeStream<T>() {
	let resolveNext: ((result: IteratorResult<T>) => void) | undefined;
	let rejectNext: ((error: unknown) => void) | undefined;
	const queue: IteratorResult<T>[] = [];
	const errors: unknown[] = [];
	let aborted = false;

	const iterable: AsyncIterable<T> = {
		[Symbol.asyncIterator](): AsyncIterator<T> {
			return {
				next(): Promise<IteratorResult<T>> {
					if (errors.length > 0) return Promise.reject(errors.shift());
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
			} else {
				errors.push(error);
			}
		},
	};
}

const flush = (): Promise<void> => Promise.resolve().then(() => Promise.resolve());

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
});

describe('createConnectStream', () => {
	it('open -> message -> close (natural completion)', async () => {
		const fake = createFakeStream<number>();
		const states: ConnectStreamState[] = [];
		const messages: number[] = [];
		let closed = 0;
		const stream = createConnectStream<number>({
			call: () => fake.iterable,
			onMessage: (m) => messages.push(m),
			onStateChange: (s) => states.push(s),
			onClose: () => (closed += 1),
		});

		stream.start();
		expect(states.at(-1)).toBe('streaming');

		fake.emit(1);
		await flush();
		fake.emit(2);
		await flush();
		expect(messages).toEqual([1, 2]);

		fake.complete();
		await flush();
		expect(states.at(-1)).toBe('closed');
		expect(closed).toBe(1);
		expect(stream.state).toBe('closed');
	});

	it('error -> backoff -> reconnect', async () => {
		let openedStreams = 0;
		const fakes: ReturnType<typeof createFakeStream<number>>[] = [];
		const errors: unknown[] = [];
		const call: StreamCall<number> = () => {
			const fake = createFakeStream<number>();
			fakes.push(fake);
			openedStreams += 1;
			return fake.iterable;
		};
		const stream = createConnectStream<number>({
			call,
			backoff: { minMs: 1000, maxMs: 10_000, jitter: 0, base: 2, random: () => 0.5 },
			onError: (e) => errors.push(e),
		});

		stream.start();
		expect(openedStreams).toBe(1);

		fakes[0]!.fail(new Error('boom'));
		await flush();
		expect(errors.length).toBe(1);
		expect(stream.attempt).toBe(1);
		// reconnect is scheduled, not yet fired
		expect(openedStreams).toBe(1);

		await vi.advanceTimersByTimeAsync(2000);
		expect(openedStreams).toBe(2);
		expect(stream.state).toBe('streaming');
	});

	it('resets the attempt counter after a message arrives', async () => {
		const fakes: ReturnType<typeof createFakeStream<number>>[] = [];
		const call: StreamCall<number> = () => {
			const fake = createFakeStream<number>();
			fakes.push(fake);
			return fake.iterable;
		};
		const stream = createConnectStream<number>({
			call,
			backoff: { minMs: 500, maxMs: 10_000, jitter: 0, random: () => 0.5 },
		});

		stream.start();
		fakes[0]!.fail(new Error('one'));
		await flush();
		expect(stream.attempt).toBe(1);

		await vi.advanceTimersByTimeAsync(1000);
		expect(fakes.length).toBe(2);
		fakes[1]!.emit(99);
		await flush();
		expect(stream.attempt).toBe(0);
	});

	it('stop() cancels the active stream + pending reconnect', async () => {
		const fakes: ReturnType<typeof createFakeStream<number>>[] = [];
		const messages: number[] = [];
		const call: StreamCall<number> = (signal) => {
			const fake = createFakeStream<number>();
			signal.addEventListener('abort', () => fake.markAborted());
			fakes.push(fake);
			return fake.iterable;
		};
		const stream = createConnectStream<number>({
			call,
			backoff: { minMs: 500, maxMs: 10_000, jitter: 0, random: () => 0.5 },
			onMessage: (m) => messages.push(m),
		});

		stream.start();
		fakes[0]!.fail(new Error('err'));
		await flush();
		expect(stream.attempt).toBe(1);

		stream.stop();
		expect(stream.state).toBe('closed');
		expect(fakes[0]!.aborted).toBe(true);

		// pending reconnect must not fire after stop()
		await vi.advanceTimersByTimeAsync(5000);
		expect(fakes.length).toBe(1);
	});

	it('ignores messages emitted after stop()', async () => {
		const fake = createFakeStream<number>();
		const messages: number[] = [];
		const stream = createConnectStream<number>({
			call: () => fake.iterable,
			onMessage: (m) => messages.push(m),
		});

		stream.start();
		fake.emit(1);
		await flush();
		stream.stop();
		fake.emit(2);
		await flush();
		expect(messages).toEqual([1]);
	});

	it('does not reconnect when an aborted stream throws', async () => {
		let opened = 0;
		const call: StreamCall<number> = (signal) => {
			opened += 1;
			return {
				[Symbol.asyncIterator](): AsyncIterator<number> {
					return {
						next(): Promise<IteratorResult<number>> {
							return new Promise((_resolve, reject) => {
								signal.addEventListener('abort', () =>
									reject(new Error('aborted')),
								);
							});
						},
					};
				},
			};
		};
		const stream = createConnectStream<number>({ call });
		stream.start();
		expect(opened).toBe(1);
		stream.stop();
		await flush();
		await vi.advanceTimersByTimeAsync(5000);
		expect(opened).toBe(1);
		expect(stream.state).toBe('closed');
	});
});
