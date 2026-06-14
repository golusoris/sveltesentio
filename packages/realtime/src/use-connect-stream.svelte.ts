import { createBufferedEmitter } from './buffered-emitter.js';
import {
	createConnectStream,
	type ConnectStreamOptions,
	type ConnectStreamState,
} from './connect-stream.js';

export interface UseConnectStreamOptions<TMessage>
	extends Omit<
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

	let state = $state<ConnectStreamState>('idle');
	let messages = $state<TMessage[]>([]);
	let lastMessage = $state<TMessage | undefined>(undefined);
	let error = $state<unknown>(undefined);
	let attempt = $state(0);

	const append = (batch: readonly TMessage[]): void => {
		if (batch.length === 0) return;
		lastMessage = batch[batch.length - 1];
		const next = messages.concat(batch);
		messages = next.length > historyLimit ? next.slice(next.length - historyLimit) : next;
	};

	const emitter =
		bufferMs > 0 ? createBufferedEmitter<TMessage>({ bufferMs, onFlush: append }) : undefined;

	const stream = createConnectStream<TMessage>({
		...streamOptions,
		onStateChange: (next) => {
			state = next;
		},
		onMessage: (message) => {
			error = undefined;
			attempt = 0;
			if (emitter) emitter.push(message);
			else append([message]);
		},
		onError: (err, nextAttempt) => {
			error = err;
			attempt = nextAttempt;
		},
	});

	$effect(() => {
		if (autoStart) stream.start();
		return () => {
			emitter?.stop();
			stream.stop();
		};
	});

	return {
		get state() {
			return state;
		},
		get lastMessage() {
			return lastMessage;
		},
		get messages() {
			return messages;
		},
		get error() {
			return error;
		},
		get attempt() {
			return attempt;
		},
		get streaming() {
			return state === 'streaming';
		},
		start() {
			stream.start();
		},
		stop() {
			emitter?.stop();
			stream.stop();
		},
	};
}
