import { type BackoffOptions } from './backoff.js';
import { createReconnectScheduler, type ReconnectScheduler } from './reconnect-scheduler.js';

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

/**
 * The state machine behind {@link createConnectStream}.
 *
 * A class for the reason `SseClient` is one: each transition is a method
 * of its own. As one closure factory the same transitions ran past the function
 * length cap, and every split short of this one cost a parameter object for
 * about a line (HISS-04). `start` and `stop` are bound fields, so a caller can
 * still hand them around detached, as the object literal this replaced allowed.
 */
class ConnectStreamMachine<TMessage> implements ConnectStream {
	private readonly options: ConnectStreamOptions<TMessage>;
	private readonly reconnect: ReconnectScheduler;
	private current: ConnectStreamState = 'idle';
	private controller: AbortController | undefined;
	/** Bumped on every stop()/start() so a stale in-flight loop self-cancels. */
	private runToken = 0;

	constructor(options: ConnectStreamOptions<TMessage>) {
		this.options = options;
		this.reconnect = createReconnectScheduler({
			backoff: options.backoff,
			setTimeoutImpl: options.setTimeoutImpl,
			clearTimeoutImpl: options.clearTimeoutImpl,
		});
	}

	get state(): ConnectStreamState {
		return this.current;
	}

	get attempt(): number {
		return this.reconnect.attempt;
	}

	readonly start = (): void => {
		if (this.current === 'streaming') return;
		this.runToken += 1;
		this.reconnect.reset();
		this.consume(this.runToken);
	};

	readonly stop = (): void => {
		this.runToken += 1;
		this.reconnect.clear();
		this.controller?.abort();
		this.controller = undefined;
		this.setState('closed');
	};

	private setState(next: ConnectStreamState): void {
		if (this.current === next) return;
		this.current = next;
		this.options.onStateChange?.(next);
	}

	/**
	 * Opens one attempt. The controller is in place before the state change is
	 * announced, so a stop() issued from inside `onStateChange` aborts this
	 * attempt and not the one before it.
	 */
	private consume(token: number): void {
		this.controller = new AbortController();
		const signal = this.controller.signal;
		this.setState('streaming');
		void this.runAttempt(token, signal);
	}

	/** One attempt, start to finish. A superseded or aborted run reports nothing. */
	private async runAttempt(token: number, signal: AbortSignal): Promise<void> {
		const isCurrent = (): boolean => token === this.runToken;
		try {
			const completed = await drainStream(this.options.call(signal), isCurrent, (message) => {
				this.reconnect.reset();
				this.options.onMessage?.(message);
			});
			if (!completed) return;
			this.setState('closed');
			this.options.onClose?.();
		} catch (error) {
			if (!isCurrent() || signal.aborted) return;
			this.options.onError?.(error, this.reconnect.attempt + 1);
			this.scheduleReconnect(token);
		}
	}

	private scheduleReconnect(token: number): void {
		this.setState('streaming');
		this.reconnect.schedule(() => {
			if (token !== this.runToken) return;
			this.consume(token);
		});
	}
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
export function createConnectStream<TMessage>(
	options: ConnectStreamOptions<TMessage>,
): ConnectStream {
	return new ConnectStreamMachine(options);
}
