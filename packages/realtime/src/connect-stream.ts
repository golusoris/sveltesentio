import { type BackoffOptions } from './backoff.js';
import { createReconnectScheduler } from './reconnect-scheduler.js';

/**
 * Lifecycle of a server-streaming consumer.
 *
 * - `idle` — created but `start()` not yet called, or fully `stop()`ped.
 * - `streaming` — actively iterating a stream (covers the gap between a
 *   reconnect being scheduled and the next iteration starting; there is no
 *   separate "connecting" since the async-iterable factory owns the dial).
 * - `closed` — the stream completed naturally, or the consumer was stopped.
 */
export type ConnectStreamState = 'idle' | 'streaming' | 'closed';

/**
 * Factory that opens one attempt of a server stream. Transport-agnostic: in
 * production this wraps a ConnectRPC server-streaming method (the async
 * iterable it returns), in tests it yields a fake stream. The `signal` is
 * aborted when the consumer is stopped so the underlying transport can cancel.
 */
export type StreamCall<TMessage> = (signal: AbortSignal) => AsyncIterable<TMessage>;

export interface ConnectStreamOptions<TMessage> {
	/** Opens one attempt of the server stream. Called once per (re)connect. */
	call: StreamCall<TMessage>;
	/** Invoked for every message yielded by the stream. */
	onMessage?: (message: TMessage) => void;
	/** Invoked on each lifecycle transition. */
	onStateChange?: (state: ConnectStreamState) => void;
	/** Invoked when an attempt rejects; `attempt` is the failed attempt count. */
	onError?: (error: unknown, attempt: number) => void;
	/** Invoked once the stream completes naturally (iterator done, no error). */
	onClose?: () => void;
	/** Backoff tuning shared with the SSE client's {@link computeBackoff}. */
	backoff?: BackoffOptions;
	/** Injectable timer for deterministic reconnect tests. */
	setTimeoutImpl?: typeof setTimeout;
	/** Injectable timer-clear paired with {@link setTimeoutImpl}. */
	clearTimeoutImpl?: typeof clearTimeout;
}

export interface ConnectStream {
	/** Current lifecycle state. */
	readonly state: ConnectStreamState;
	/** Reconnect attempt counter; resets to 0 after a message is received. */
	readonly attempt: number;
	/** Begin consuming the stream (no-op if already streaming). */
	start(): void;
	/** Cancel the active stream + any pending reconnect; transition to closed. */
	stop(): void;
}

/**
 * Transport-agnostic server-streaming state machine. Consumes an injected
 * async-iterable {@link StreamCall}, surfaces messages + lifecycle, and
 * reconnects with the shared jittered {@link computeBackoff} after a failed
 * attempt. Holds no Svelte / ConnectRPC imports so it unit-tests against a
 * fake stream with no network, grpc, or runes runtime.
 *
 * Natural completion (the iterator finishing without throwing) is a terminal
 * `closed` — only thrown errors trigger backoff + reconnect.
 */
/**
 * Drains an async iterable, handing each item to `onMessage`.
 *
 * Resolves true when the run completed while still current, and false the moment
 * `isCurrent` turns false — a newer start()/stop() has superseded this run and
 * its completion must not be acted on. Lives at module scope rather than inside
 * the factory so it is independently testable, and so its body does not count
 * against the factory's length (HISS-04).
 */
async function drainStream<TMessage>(
	source: AsyncIterable<TMessage>,
	isCurrent: () => boolean,
	onMessage: (message: TMessage) => void,
): Promise<boolean> {
	for await (const message of source) {
		if (!isCurrent()) return false;
		onMessage(message);
	}
	return isCurrent();
}

export function createConnectStream<TMessage>(
	options: ConnectStreamOptions<TMessage>,
): ConnectStream {
	const reconnect = createReconnectScheduler({
		backoff: options.backoff,
		setTimeoutImpl: options.setTimeoutImpl,
		clearTimeoutImpl: options.clearTimeoutImpl,
	});

	let state: ConnectStreamState = 'idle';
	let controller: AbortController | undefined;
	/** Bumped on every stop()/start() so a stale in-flight loop self-cancels. */
	let runToken = 0;

	const setState = (next: ConnectStreamState): void => {
		if (state === next) return;
		state = next;
		options.onStateChange?.(next);
	};

	const consume = (token: number): void => {
		const isCurrent = (): boolean => token === runToken;
		controller = new AbortController();
		const signal = controller.signal;
		setState('streaming');
		void (async () => {
			try {
				const completed = await drainStream(options.call(signal), isCurrent, (message) => {
					reconnect.reset();
					options.onMessage?.(message);
				});
				if (!completed) return;
				setState('closed');
				options.onClose?.();
			} catch (error) {
				if (token !== runToken || signal.aborted) return;
				options.onError?.(error, reconnect.attempt + 1);
				scheduleReconnect(token);
			}
		})();
	};

	const scheduleReconnect = (token: number): void => {
		setState('streaming');
		reconnect.schedule(() => {
			if (token !== runToken) return;
			consume(token);
		});
	};

	return {
		get state(): ConnectStreamState {
			return state;
		},
		get attempt(): number {
			return reconnect.attempt;
		},
		start(): void {
			if (state === 'streaming') return;
			runToken += 1;
			reconnect.reset();
			consume(runToken);
		},
		stop(): void {
			runToken += 1;
			reconnect.clear();
			controller?.abort();
			controller = undefined;
			setState('closed');
		},
	};
}
