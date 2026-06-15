import type { Client } from '@connectrpc/connect';
import type { DescService } from '@bufbuild/protobuf';
import {
	createConnectStream,
	type ConnectStreamState,
	type ConnectStreamOptions,
} from '../connect-stream.js';

/**
 * Selects a server-streaming method off a typed {@link Client} and invokes it
 * with the request + per-call options (carrying the abort `signal`). Returning
 * the client's own method keeps the output type inferred from the descriptor.
 */
export type StreamMethodSelector<T extends DescService, TMessage> = (
	client: Client<T>,
	request: { signal: AbortSignal },
) => AsyncIterable<TMessage>;

export interface UseConnectRpcStreamOptions<T extends DescService, TMessage> {
	/** Typed Connect client; inject a `createRouterTransport(...)`-backed one in tests. */
	client: Client<T>;
	/** Invokes the server-streaming method, forwarding the abort `signal`. */
	call: StreamMethodSelector<T, TMessage>;
	/** Start consuming from inside the mount `$effect` (default `true`). */
	autoStart?: boolean;
	/** Backoff tuning forwarded to {@link createConnectStream}. */
	backoff?: ConnectStreamOptions<TMessage>['backoff'];
	/** Injectable timer for deterministic reconnect tests. */
	setTimeoutImpl?: typeof setTimeout;
	/** Injectable timer-clear paired with {@link setTimeoutImpl}. */
	clearTimeoutImpl?: typeof clearTimeout;
}

export interface UseConnectRpcStream<TMessage> {
	/** Accumulated messages, oldest first. */
	readonly data: readonly TMessage[];
	/** Current stream lifecycle: `idle | streaming | closed`. */
	readonly status: ConnectStreamState;
	/** Last error from a failed attempt, cleared once a message arrives. */
	readonly error: unknown;
	/** Begin consuming (no-op if already streaming). */
	start(): void;
	/** Cancel the stream + stop reconnecting. */
	stop(): void;
}

/**
 * ConnectRPC-bound variant of {@link createConnectStream} for `.svelte`
 * consumers: calls a server-streaming method off an injected typed `client`
 * and exposes `{ data, status, error }` runes. Ties start/stop to the caller's
 * `$effect` (SSR-safe — `$effect` does not run on the server). The client is
 * injected, so this unit-tests against a `createRouterTransport(...)` fake.
 */
export function useConnectStream<T extends DescService, TMessage>(
	options: UseConnectRpcStreamOptions<T, TMessage>,
): UseConnectRpcStream<TMessage> {
	const { client, call, autoStart = true, backoff, setTimeoutImpl, clearTimeoutImpl } = options;

	let data = $state<TMessage[]>([]);
	let status = $state<ConnectStreamState>('idle');
	let error = $state<unknown>(undefined);

	const stream = createConnectStream<TMessage>({
		call: (signal) => call(client, { signal }),
		...(backoff !== undefined ? { backoff } : {}),
		...(setTimeoutImpl !== undefined ? { setTimeoutImpl } : {}),
		...(clearTimeoutImpl !== undefined ? { clearTimeoutImpl } : {}),
		onStateChange: (next) => {
			status = next;
		},
		onMessage: (message) => {
			error = undefined;
			data = data.concat([message]);
		},
		onError: (err) => {
			error = err;
		},
	});

	$effect(() => {
		if (autoStart) stream.start();
		return () => {
			stream.stop();
		};
	});

	return {
		get data() {
			return data;
		},
		get status() {
			return status;
		},
		get error() {
			return error;
		},
		start() {
			stream.start();
		},
		stop() {
			stream.stop();
		},
	};
}
