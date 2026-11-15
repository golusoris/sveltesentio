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
	 * Resolves the current auth token. It is called as each socket is built, the
	 * first dial included, so a held-back connect or a dial after a long backoff
	 * sends the token current at that moment. Returning `null` / `undefined` /
	 * `''` attaches nothing (anonymous connect). A throw refuses that dial: no
	 * request goes out, the error is logged and reaches y-websocket's
	 * `connection-error` event, and the provider dials again after its backoff.
	 * Tests: `test/provider-reconnect.test.ts` P4, P6, N7.
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

type SocketConstructor = WebsocketProvider['_WS'];

/**
 * The slice of `WebsocketProvider` the auth binding touches.
 *
 * The binding reads and replaces `_WS`, the socket constructor y-websocket calls
 * for every dial, and writes nothing else. `params`, `protocols`, `on` and `off`
 * stay in the type so a stand-in written against its earlier shape still
 * compiles (the public API is append-only); `_WS` is optional for the same
 * reason, and a provider without it gets a warning and no auth. A real
 * `WebsocketProvider` remains assignable, so callers are unchanged.
 */
export interface AuthBindableProvider {
	params: Record<string, string>;
	protocols: string[];
	on(event: 'connection-close', cb: () => void): void;
	off(event: 'connection-close', cb: () => void): void;
	_WS?: SocketConstructor;
}

/**
 * The socket constructor of the binding that injects auth on each provider. A
 * later `bindProviderAuth` on the same provider replaces the entry, so only one
 * binding injects. Keyed weakly, so a dropped provider is not retained.
 * Tests: `test/provider-auth.test.ts` "lets only the latest binding inject".
 */
const activeBindings = new WeakMap<object, SocketConstructor>();

/**
 * Entries of `next` absent from `present`, each once. Browsers reject a
 * repeated subprotocol (WHATWG WebSockets, `new WebSocket()` step "occur more
 * than once"). Tests: `test/provider-reconnect.test.ts` N6.
 */
function missingEntries(present: readonly string[], next: readonly string[]): string[] {
	return next.filter((entry, index) => !present.includes(entry) && next.indexOf(entry) === index);
}

/**
 * The caller subprotocols y-websocket passed, as a new array, with the auth
 * entries the caller does not already send appended. The caller's array is
 * never mutated. Tests: `test/provider-reconnect.test.ts` N4, N6.
 */
function dialProtocols(
	callerProtocols: string | string[] | undefined,
	authProtocols: readonly string[],
): string[] {
	let list: string[] = [];
	if (typeof callerProtocols === 'string') list = [callerProtocols];
	else if (callerProtocols !== undefined) list = [...callerProtocols];
	return [...list, ...missingEntries(list, authProtocols)];
}

/** The key of one `key=value` query pair, still percent-encoded. */
function queryKey(pair: string): string {
	const equals = pair.indexOf('=');
	return equals >= 0 ? pair.slice(0, equals) : pair;
}

/**
 * `url` with the auth query pairs appended, after dropping caller pairs under
 * the same keys. Keys are compared percent-encoded, the form y-websocket writes
 * (`encodeQueryParams` in lib0 `url.js`), and the query is the part after the
 * last `?`, which y-websocket writes only in front of its encoded params. With
 * no auth pairs the URL is returned as is, so a caller pair the token shadowed
 * is sent again once the token is revoked. Tests:
 * `test/provider-reconnect.test.ts` N3, N10, N12.
 */
function dialUrl(url: string, authParams: Readonly<Record<string, string>>): string {
	const authPairs = Object.entries(authParams).map(
		([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
	);
	if (authPairs.length === 0) return url;
	const replaced = new Set(authPairs.map((pair) => queryKey(pair)));
	const cut = url.lastIndexOf('?');
	const base = cut >= 0 ? url.slice(0, cut) : url;
	const query = cut >= 0 ? url.slice(cut + 1) : '';
	const kept = query.split('&').filter((pair) => pair !== '' && !replaced.has(queryKey(pair)));
	return `${base}?${[...kept, ...authPairs].join('&')}`;
}

/** Runs one socket event handler; a throw is logged so the next event still fires. */
function runHandler(handler: () => void): void {
	try {
		handler();
	} catch (error) {
		console.error('[sentio] collab: socket event handler threw', error);
	}
}

/**
 * Socket stand-in for a dial whose token resolver threw. It opens no
 * connection. On the next microtask it fires `onerror`, carrying the resolver
 * error as `error`, then `onclose` with code 1006, so y-websocket emits
 * `connection-error` and `connection-close` and backs off before it dials
 * again, as for a refused connection. A throwing handler is logged and does not
 * stop the close, as in a browser. y-websocket attaches handlers through the
 * `on…` properties only, so listener registration is accepted and never fires.
 * Tests: `test/provider-reconnect.test.ts` N7, N11; `test/provider-auth.test.ts`
 * "refuses the dial without building a socket when the resolver throws".
 */
class RefusedDial implements WebSocket {
	readonly CONNECTING = 0;
	readonly OPEN = 1;
	readonly CLOSING = 2;
	readonly CLOSED = 3;
	readonly bufferedAmount = 0;
	readonly extensions = '';
	readonly protocol = '';
	readonly url: string;
	binaryType: BinaryType = 'blob';
	readyState: WebSocket['readyState'] = this.CONNECTING;
	onclose: WebSocket['onclose'] = null;
	onerror: WebSocket['onerror'] = null;
	onmessage: WebSocket['onmessage'] = null;
	onopen: WebSocket['onopen'] = null;

	constructor(url: string, cause: unknown) {
		this.url = url;
		queueMicrotask(() => {
			this.refuse(cause);
		});
	}

	private refuse(cause: unknown): void {
		if (this.readyState === this.CLOSED) return;
		this.readyState = this.CLOSED;
		const error = Object.assign(new Event('error'), { error: cause });
		const close = Object.assign(new Event('close'), {
			code: 1006,
			reason: 'auth token resolver threw',
			wasClean: false,
		});
		runHandler(() => {
			this.onerror?.(error);
		});
		runHandler(() => {
			this.onclose?.(close);
		});
	}

	close(): void {
		this.readyState = this.CLOSED;
	}

	send(): void {
		// Never opens, and y-websocket sends only after `onopen`.
	}

	addEventListener(): void {
		// Accepted and never fired: y-websocket uses the `on…` properties.
	}

	removeEventListener(): void {
		// addEventListener registers nothing, so there is nothing to remove.
	}

	dispatchEvent(): boolean {
		// No listener runs (see addEventListener); the event is not cancelled.
		return true;
	}
}

/** Logs a resolver throw and returns a socket that dials nothing. */
function refuseDial(url: string, cause: unknown): WebSocket {
	console.error('[sentio] collab: auth token resolver threw; dial refused', cause);
	return new RefusedDial(url, cause);
}

/**
 * Subclass of `Base` that resolves `auth` as each socket is built, the last
 * point a fresh token can still reach the dial: y-websocket builds every socket
 * with `new provider._WS(provider.url, provider.protocols)` (`setupWS` in
 * y-websocket 3.1.0 `src/y-websocket.js`). Nothing is written to the provider,
 * so its `params` and `protocols` keep caller entries only. While another
 * binding on the provider is active, this one passes the dial through.
 */
function authSocket(
	provider: object,
	Base: SocketConstructor,
	auth: AuthBinding | string | (() => string | null | undefined),
): SocketConstructor {
	const AuthSocket = class extends Base {
		constructor(url: string | URL, protocols?: string | string[]) {
			if (activeBindings.get(provider) !== AuthSocket) {
				super(url, protocols);
				return;
			}
			let resolved: ResolvedAuth;
			try {
				resolved = resolveAuthParams(auth);
			} catch (cause) {
				return refuseDial(String(url), cause);
			}
			super(dialUrl(String(url), resolved.params), dialProtocols(protocols, resolved.protocols));
		}
	};
	return AuthSocket;
}

/**
 * Binds `auth` to a provider so every dial carries the token current at that
 * moment; for callers that construct the provider themselves, and used by
 * `connectProvider`. The binding wraps `provider._WS` and builds each dial's URL
 * and subprotocols from the caller's `provider.params` and `provider.protocols`
 * plus the resolved token, writing neither field. A revoked token therefore
 * leaves both the URL and the subprotocols, caller entries are read afresh at
 * every dial, and a caller subprotocol equal to an auth one is sent once. A
 * resolver throw refuses that dial (see `AuthBinding.token`).
 *
 * Binding the same provider again replaces the earlier binding, which then
 * passes dials through. The returned unbind stops this binding and puts back
 * the socket constructor it wrapped, unless something has wrapped it since.
 * Tests: the `bindProviderAuth` block in `test/provider-auth.test.ts`.
 */
export function bindProviderAuth(
	provider: AuthBindableProvider,
	auth: AuthBinding | string | (() => string | null | undefined),
): () => void {
	const Base = provider._WS;
	if (Base === undefined) {
		console.warn('[sentio] collab: provider has no _WS socket constructor; auth not bound');
		return () => {
			// Nothing was bound.
		};
	}
	const AuthSocket = authSocket(provider, Base, auth);
	activeBindings.set(provider, AuthSocket);
	provider._WS = AuthSocket;
	return () => {
		if (activeBindings.get(provider) === AuthSocket) activeBindings.delete(provider);
		if (provider._WS === AuthSocket) provider._WS = Base;
	};
}

/**
 * Collects the optional `WebsocketProvider` settings into its options bag.
 *
 * Every field is assigned only when the caller supplied it: y-websocket derives its
 * own defaults from an absent key, and under `exactOptionalPropertyTypes` a key set
 * to `undefined` is not the same as one that was never set. `connect` is held back
 * (`false`) so the first `'connecting'` reaches `onStatusChange`
 * (`test/provider-reconnect.test.ts` N5).
 */
function buildProviderOptions(
	options: ConnectProviderOptions,
	callerParams: Record<string, string>,
	callerProtocols: string[],
): ConstructorParameters<typeof WebsocketProvider>[3] {
	const { awareness, WebSocketPolyfill, resyncInterval, maxBackoffTime, disableBc } = options;
	const providerOptions: ConstructorParameters<typeof WebsocketProvider>[3] = { connect: false };
	if (awareness !== undefined) providerOptions.awareness = awareness;
	if (Object.keys(callerParams).length > 0) providerOptions.params = callerParams;
	if (callerProtocols.length > 0) providerOptions.protocols = callerProtocols;
	if (WebSocketPolyfill !== undefined) providerOptions.WebSocketPolyfill = WebSocketPolyfill;
	if (resyncInterval !== undefined) providerOptions.resyncInterval = resyncInterval;
	if (maxBackoffTime !== undefined) providerOptions.maxBackoffTime = maxBackoffTime;
	if (disableBc !== undefined) providerOptions.disableBc = disableBc;
	return providerOptions;
}

/**
 * Subscribes the optional status and sync callbacks, returning the matching detach.
 *
 * Pairing attach with detach here keeps the two lists from drifting apart:
 * previously `connectProvider` registered each listener in one place and removed it
 * in another, so a listener added without a matching `off` would outlive
 * `disconnect()`.
 */
function bindProviderEvents(
	provider: WebsocketProvider,
	onStatusChange?: (status: ProviderStatus) => void,
	onSync?: (synced: boolean) => void,
): () => void {
	const handleStatus = onStatusChange
		? ({ status }: { status: string }) => {
				onStatusChange(normaliseStatus(status));
			}
		: undefined;
	const handleSync = onSync ? (synced: boolean) => onSync(synced) : undefined;
	if (handleStatus) provider.on('status', handleStatus);
	if (handleSync) provider.on('sync', handleSync);
	return () => {
		if (handleStatus) provider.off('status', handleStatus);
		if (handleSync) provider.off('sync', handleSync);
	};
}

/**
 * Starts the first dial. y-websocket emits `'connecting'` synchronously inside
 * `connect()`, so a throwing `onStatusChange` lands here; the provider is torn
 * down before the error is rethrown. Tests: `test/provider-reconnect.test.ts` N8.
 */
function startOrTearDown(provider: WebsocketProvider, teardown: () => void): void {
	try {
		provider.connect();
	} catch (error) {
		teardown();
		throw error;
	}
}

export function connectProvider(options: ConnectProviderOptions): ConnectedProvider {
	const { url, room, doc, params, protocols, auth, onStatusChange, onSync } = options;

	const callerParams = { ...params };
	const callerProtocols = [...(protocols ?? [])];

	const provider = new WebsocketProvider(
		url,
		room,
		doc,
		buildProviderOptions(options, callerParams, callerProtocols),
	);

	const unbindAuth = auth !== undefined ? bindProviderAuth(provider, auth) : undefined;

	const unbindEvents = bindProviderEvents(provider, onStatusChange, onSync);

	const disconnect = (): void => {
		if (unbindAuth) unbindAuth();
		unbindEvents();
		provider.disconnect();
		provider.destroy();
	};

	if (options.connect !== false) startOrTearDown(provider, disconnect);

	return { provider, disconnect };
}

function normaliseStatus(status: string): ProviderStatus {
	if (status === 'connected') return 'connected';
	if (status === 'connecting') return 'connecting';
	return 'disconnected';
}
