import { createStreamStatus } from './stream-status.svelte.js';
import {
	createConnectStream,
	type ConnectStreamOptions,
	type ConnectStreamState,
} from './connect-stream.js';

export interface UseConnectStreamOptions<TMessage> extends Omit<
	ConnectStreamOptions<TMessage>,
	'onMessage' | 'onStateChange' | 'onError' | 'onClose'
> {
	/** Start consuming from inside an `$effect` on mount (default `true`). */
	autoStart?: boolean;
	/**
	 * Throttle reactive message flushes to at most one per `bufferMs` so a
	 * high-rate stream does not thrash the render loop. `0` (default) flushes
	 * each message synchronously.
	 */
	bufferMs?: number;
	/** Cap on retained recent messages in `messages` (default `100`). */
	historyLimit?: number;
}

export interface UseConnectStream<TMessage> {
	/** Current stream lifecycle state. */
	readonly state: ConnectStreamState;
	/** Most recent message, or `undefined` before the first arrives. */
	readonly lastMessage: TMessage | undefined;
	/** Bounded buffer of recent messages, oldest first. */
	readonly messages: readonly TMessage[];
	/** Last error surfaced by a failed attempt, cleared on the next message. */
	readonly error: unknown;
	/** Reconnect attempt counter; resets to 0 once a message is received. */
	readonly attempt: number;
	/** `true` while the stream state is `streaming`. */
	readonly streaming: boolean;
	/** Begin consuming (no-op if already streaming). */
	start(): void;
	/** Cancel the stream + stop reconnecting. */
	stop(): void;
}

/**
 * Runes-native wrapper over {@link createConnectStream} for `.svelte`
 * consumers, mirroring `useSSE`. Holds reactive `$state` for stream state +
 * messages and ties the stream lifecycle to the caller's `$effect` (starts on
 * mount, stops on teardown). SSR-safe: `$effect` does not run on the server.
 *
 * The transport is injected via the `call` seam, so this module imports
 * neither `@connectrpc/connect` nor `@connectrpc/connect-web` — those stay
 * optional peers consumed only at the call site that builds `call`.
 */
export function useConnectStream<TMessage>(
	options: UseConnectStreamOptions<TMessage>,
): UseConnectStream<TMessage> {
	const { autoStart = true, bufferMs = 0, historyLimit = 100, ...streamOptions } = options;

	const status = createStreamStatus<ConnectStreamState, TMessage>('idle', historyLimit, bufferMs);

	const stream = createConnectStream<TMessage>({
		...streamOptions,
		onStateChange: (next) => {
			status.onStateChange(next);
		},
		onMessage: (message) => {
			status.resetError();
			status.resetAttempt();
			status.push(message);
		},
		onError: (err, nextAttempt) => {
			status.onError(err, nextAttempt);
		},
	});

	$effect(() => {
		if (autoStart) stream.start();
		return () => {
			status.stop();
			stream.stop();
		};
	});

	return status.attach({
		get streaming() {
			return status.state === 'streaming';
		},
		start() {
			stream.start();
		},
		stop() {
			status.stop();
			stream.stop();
		},
	});
}
