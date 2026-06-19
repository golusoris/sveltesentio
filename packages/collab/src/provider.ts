import type * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

export type ProviderStatus = 'disconnected' | 'connecting' | 'connected';

/**
 * Browser `WebSocket` cannot set arbitrary HTTP headers, so `y-websocket`
 * carries auth as a URL query parameter (appended to the connect URL) and/or
 * a `Sec-WebSocket-Protocol` subprotocol entry. `AuthBinding` describes how a
 * caller-supplied token maps onto those two transports. The token is
 * resolved at connect time via a function so callers can inject a rotating /
 * session-scoped value without hard-coding a secret.
 */
export interface AuthBinding {
	/**
	 * Resolves the current auth token. Called once at construction and again on
	 * every reconnect so a rotated token takes effect on the next dial. Returning
	 * `null` / `undefined` / `''` attaches nothing (anonymous connect).
	 */
	readonly token: string | (() => string | null | undefined);
	/**
	 * Query-parameter key the token is attached under. `y-websocket` appends it
	 * to the WS connect URL. Defaults to `'token'`. Set to `null` to skip the
	 * query-param transport (e.g. when only the subprotocol carries the token).
	 */
	readonly param?: string | null;
	/**
	 * When set, the token is also emitted as a WebSocket subprotocol entry,
	 * formatted as `${protocol}.${token}`. A Node `ws` polyfill surfaces this on
	 * the server as the `Sec-WebSocket-Protocol` header, the closest browser-safe
	 * analogue to an `Authorization` header.
	 */
	readonly protocol?: string;
}

export interface ResolvedAuth {
	readonly params: Readonly<Record<string, string>>;
	readonly protocols: readonly string[];
}

export interface ConnectProviderOptions {
	readonly url: string;
	readonly room: string;
	readonly doc: Y.Doc;
	readonly params?: Readonly<Record<string, string>>;
	readonly protocols?: readonly string[];
	readonly auth?: AuthBinding | string | (() => string | null | undefined);
	readonly resyncInterval?: number;
	readonly maxBackoffTime?: number;
	readonly disableBc?: boolean;
	readonly connect?: boolean;
	readonly awareness?: WebsocketProvider['awareness'];
	readonly WebSocketPolyfill?: typeof WebSocket;
	readonly onStatusChange?: (status: ProviderStatus) => void;
	readonly onSync?: (synced: boolean) => void;
}

export interface ConnectedProvider {
	readonly provider: WebsocketProvider;
	readonly disconnect: () => void;
}

/** Normalises a loose `auth` option into a full `AuthBinding`. */
function toAuthBinding(
	auth: AuthBinding | string | (() => string | null | undefined),
): AuthBinding {
	if (typeof auth === 'string' || typeof auth === 'function') return { token: auth };
	return auth;
}

/**
 * Pure resolver: turns an `AuthBinding` into the `{ params, protocols }` that
 * `y-websocket` consumes. Re-callable — every call re-reads the token, so a
 * rotating token resolver is reflected on the next connect. Exported so the
 * mapping is unit-testable without a socket.
 */
export function resolveAuthParams(
	auth: AuthBinding | string | (() => string | null | undefined),
): ResolvedAuth {
	const binding = toAuthBinding(auth);
	const token = typeof binding.token === 'function' ? binding.token() : binding.token;
	if (token === null || token === undefined || token === '') {
		return { params: {}, protocols: [] };
	}
	const params: Record<string, string> = {};
	const key = binding.param === undefined ? 'token' : binding.param;
	if (key !== null) params[key] = token;
	const protocols: string[] = [];
	if (binding.protocol !== undefined) protocols.push(`${binding.protocol}.${token}`);
	return { params, protocols };
}

/**
 * Re-resolves `auth` into the live provider's mutable `params` (and protocols)
 * so a rotated token is picked up on the next reconnect. `y-websocket` re-reads
 * `provider.params` each time it dials. Returns an unbind function. Exported for
 * callers that construct the provider themselves.
 */
export function bindProviderAuth(
	provider: Pick<WebsocketProvider, 'params' | 'protocols' | 'on' | 'off'>,
	auth: AuthBinding | string | (() => string | null | undefined),
): () => void {
	const apply = (): void => {
		const { params, protocols } = resolveAuthParams(auth);
		Object.assign(provider.params, params);
		if (protocols.length > 0) provider.protocols = [...protocols];
	};
	apply();
	const rebind = (): void => apply();
	provider.on('connection-close', rebind);
	return () => provider.off('connection-close', rebind);
}

export function connectProvider(options: ConnectProviderOptions): ConnectedProvider {
	const {
		url,
		room,
		doc,
		params,
		protocols,
		auth,
		resyncInterval,
		maxBackoffTime,
		disableBc,
		connect,
		awareness,
		WebSocketPolyfill,
		onStatusChange,
		onSync,
	} = options;

	const resolved = auth !== undefined ? resolveAuthParams(auth) : undefined;
	const mergedParams = { ...params, ...resolved?.params };
	const mergedProtocols = [...(protocols ?? []), ...(resolved?.protocols ?? [])];

	const providerOptions: ConstructorParameters<typeof WebsocketProvider>[3] = {};
	if (connect !== undefined) providerOptions.connect = connect;
	if (awareness !== undefined) providerOptions.awareness = awareness;
	if (Object.keys(mergedParams).length > 0) providerOptions.params = mergedParams;
	if (mergedProtocols.length > 0) providerOptions.protocols = mergedProtocols;
	if (WebSocketPolyfill !== undefined)
		providerOptions.WebSocketPolyfill = WebSocketPolyfill;
	if (resyncInterval !== undefined) providerOptions.resyncInterval = resyncInterval;
	if (maxBackoffTime !== undefined) providerOptions.maxBackoffTime = maxBackoffTime;
	if (disableBc !== undefined) providerOptions.disableBc = disableBc;

	const provider = new WebsocketProvider(url, room, doc, providerOptions);

	const unbindAuth =
		auth !== undefined ? bindProviderAuth(provider, auth) : undefined;

	const handleStatus = onStatusChange
		? ({ status }: { status: string }) => {
				onStatusChange(normaliseStatus(status));
			}
		: undefined;
	const handleSync = onSync ? (synced: boolean) => onSync(synced) : undefined;

	if (handleStatus) provider.on('status', handleStatus);
	if (handleSync) provider.on('sync', handleSync);

	const disconnect = (): void => {
		if (unbindAuth) unbindAuth();
		if (handleStatus) provider.off('status', handleStatus);
		if (handleSync) provider.off('sync', handleSync);
		provider.disconnect();
		provider.destroy();
	};

	return { provider, disconnect };
}

function normaliseStatus(status: string): ProviderStatus {
	if (status === 'connected') return 'connected';
	if (status === 'connecting') return 'connecting';
	return 'disconnected';
}
