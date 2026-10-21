/// <reference types="svelte" />
import { createStreamStatus } from './stream-status.svelte.js';
import {
	SseClient,
	type SseClientOptions,
	type SseClientState,
	type SseEventLike,
} from './sse-client.js';

export interface UseSseOptions extends Omit<
	SseClientOptions,
	'onOpen' | 'onMessage' | 'onError' | 'onStateChange'
> {
	/** Open the connection from inside an `$effect` on mount (default `true`). */
	autoConnect?: boolean;
	/**
	 * Throttle reactive message flushes to at most one per `bufferMs` so a
	 * high-rate feed does not thrash the render loop. `0` (default) flushes
	 * each message synchronously.
	 */
	bufferMs?: number;
	/** Cap on retained recent messages in `messages` (default `100`). */
	historyLimit?: number;
}

export interface UseSse {
	/** Current transport state. */
	readonly state: SseClientState;
	/** Most recent message, or `undefined` before the first arrives. */
	readonly lastMessage: SseEventLike | undefined;
	/** Bounded buffer of recent messages, oldest first. */
	readonly messages: readonly SseEventLike[];
	/** Last error surfaced by the transport, cleared on (re)open. */
	readonly error: unknown;
	/** Reconnect attempt counter; resets to 0 on a successful open. */
	readonly attempt: number;
	/** `true` while the transport state is `open`. */
	readonly connected: boolean;
	/** Open the connection (no-op if already connecting/open). */
	connect(): void;
	/** Close the connection and stop reconnecting. */
	close(): void;
}

/**
 * Runes-native wrapper over {@link SseClient} for `.svelte` consumers. Holds
 * reactive `$state` for transport state and messages, and ties the connection
 * lifecycle to the calling component via `$effect` (connects on mount, closes
 * on teardown). SSR-safe: `$effect` does not run on the server, so no
 * connection is opened there.
 */
export function useSSE(options: UseSseOptions): UseSse {
	const { autoConnect = true, bufferMs = 0, historyLimit = 100, ...clientOptions } = options;

	const status = createStreamStatus<SseClientState, SseEventLike>('idle', historyLimit, bufferMs);

	const client = new SseClient({
		...clientOptions,
		onStateChange: (next) => {
			status.onStateChange(next);
		},
		onOpen: () => {
			status.resetError();
		},
		onMessage: (event) => {
			status.push(event);
		},
		onError: (err, nextAttempt) => {
			status.onError(err, nextAttempt);
		},
	});

	const teardown = (): void => {
		status.stop();
		client.close();
	};

	$effect(() => {
		if (autoConnect) client.start();
		return teardown;
	});

	return status.attach({
		get connected() {
			return status.state === 'open';
		},
		connect() {
			client.start();
		},
		close: teardown,
	});
}
