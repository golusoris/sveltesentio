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
	 * request goes out, the error is logged by its label only, y-websocket's
	 * `connection-error` gets a plain `error` event without the thrown value, as
	 * for a refused connection, and the provider dials again after its backoff.
	 * A token that cannot go on the wire refuses the dial the same way: one with
	 * a lone UTF-16 surrogate, which `encodeURIComponent` rejects, or a
	 * subprotocol entry outside the RFC 6455 token characters. Tests:
	 * `test/provider-reconnect.test.ts` P4, P6, N7; `test/provider-auth.test.ts`
	 * "refuses a dial whose token cannot be encoded".
	 */
	readonly token: string | (() => string | null | undefined);
	/**
	 * Query-parameter key the token is attached under. `y-websocket` appends it
	 * to the WS connect URL. Defaults to `'token'`. Set to `null` to skip the
	 * query-param transport (e.g. when only the subprotocol carries the token).
	 * While a token resolves it replaces a caller param under the same key; while
	 * none does, the caller param is sent, so a caller value under this key is a
	 * fallback such as a guest token, never a copy of the session token.
	 */
	readonly param?: string | null;
	/**
	 * When set, the token is also emitted as a WebSocket subprotocol entry,
	 * formatted as `${protocol}.${token}`. A Node `ws` polyfill surfaces this on
	 * the server as the `Sec-WebSocket-Protocol` header, the closest browser-safe
	 * analogue to an `Authorization` header. Caller subprotocols are always sent,
	 * also one of the form `${protocol}.…`, so keep the token out of them.
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
 * for every dial, and otherwise writes only a symbol-keyed slot naming the
 * active binding (`ACTIVE_BINDING`). `params`, `protocols`, `on` and `off`
 * stay in the type so a stand-in written against its earlier shape keeps them.
 * `_WS` is required: without it no dial can carry the token, so a stand-in
 * that lacks it fails to compile instead of connecting without credentials. A
 * real `WebsocketProvider` (y-websocket 2.0.0 and later) has it and remains
 * assignable. A provider that reaches `bindProviderAuth` without `_WS` anyway,
 * from untyped code or through a cast, gets a `console.error` and no binding.
 */
export interface AuthBindableProvider {
	params: Record<string, string>;
	protocols: string[];
	on(event: 'connection-close', cb: () => void): void;
	off(event: 'connection-close', cb: () => void): void;
	_WS: SocketConstructor;
}

/**
 * Key of the slot on a provider that names the binding injecting auth there. A
 * later `bindProviderAuth` on the same provider overwrites the slot, so only one
 * binding injects. The slot lives on the provider it describes, as `RETRIED`
 * does on a request in `packages/api/src/auth-middleware.ts`, so this module
 * keeps no mutable state (`docs/principles.md` §2.1, row 6). Tests:
 * `test/provider-auth.test.ts` "lets only the latest binding inject" and "keeps
 * the binding of each provider apart".
 */
const ACTIVE_BINDING = Symbol('sveltesentio.collab.activeBinding');

/** A provider seen through its active-binding slot. */
interface BindingSlot {
	[ACTIVE_BINDING]?: SocketConstructor | undefined;
}

/** Whether the binding whose socket class is `self` is the one active on `slot`. */
function isActive(slot: BindingSlot, self: SocketConstructor): boolean {
	return slot[ACTIVE_BINDING] === self;
}

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

/**
 * The error names a log line may carry as they are: the ECMAScript native
 * errors (ECMA-262 §20.5 `Error`, §20.5.5 the native error types, §20.5.7
 * `AggregateError`). Any other `name` is free text a thrower chose.
 */
const NATIVE_ERROR_NAMES: ReadonlySet<string> = new Set([
	'Error',
	'EvalError',
	'RangeError',
	'ReferenceError',
	'SyntaxError',
	'TypeError',
	'URIError',
	'AggregateError',
]);

/**
 * A loggable label for a thrown value: a native error name, `'custom Error'`
 * for any other error, or else the value's type. The message, a custom name and
 * other fields stay out of the log, because a resolver or handler error can
 * carry the token it failed on. Tests: `test/provider-auth.test.ts` "logs only
 * the name of a resolver error" and "withholds a custom error name".
 */
function errorLabel(error: unknown): string {
	if (!(error instanceof Error)) return typeof error;
	return NATIVE_ERROR_NAMES.has(error.name) ? error.name : 'custom Error';
}

/** Why a dial was refused; also the reason of its close event. */
type RefusalReason =
	| 'auth token resolver threw'
	| 'auth binding replaced while its token resolved'
	| 'auth token cannot be encoded for the dial';

/** A refused dial: its reason and, when something threw, the thrown value. */
interface Refusal {
	readonly reason: RefusalReason;
	readonly cause?: unknown;
}

/** What one dial of a binding does. */
type DialPlan =
	| { readonly kind: 'pass' }
	| { readonly kind: 'refuse'; readonly refusal: Refusal }
	| { readonly kind: 'dial'; readonly url: string; readonly protocols: string[] };

const PASS_THROUGH: DialPlan = { kind: 'pass' };

/**
 * The characters of a `Sec-WebSocket-Protocol` element: RFC 6455 §4.1 item 10
 * (`1#token`, RFC 2616 token characters), which the WHATWG `WebSocket`
 * constructor enforces with a `SyntaxError`. The same allow-list as
 * `subprotocolRegex` in `ws` 8.22.0 `lib/websocket.js`.
 */
const PROTOCOL_TOKEN = /^[!#$%&'*+\-.0-9A-Z^_`|a-z~]+$/;

/** Runs one socket event handler; a throw is logged so the next event still fires. */
function runHandler(handler: () => void): void {
	try {
		handler();
	} catch (error) {
		console.error('[sentio] collab: socket event handler threw:', errorLabel(error));
	}
}

/**
 * Socket stand-in for a refused dial: its token resolver threw, its binding was
 * replaced while the token resolved, or the token cannot be encoded. It opens
 * no connection. On the next microtask it fires a plain `error` event, which
 * like a browser's carries no detail, so neither the thrown value nor the token
 * reaches `connection-error` listeners, then `close` with code 1006 and the
 * refusal reason, so y-websocket emits `connection-error` and
 * `connection-close` and backs off before it dials again, as for a refused
 * connection. Each event goes to the `on…` handler, then to the listeners added
 * with `addEventListener`. A throwing `on…` handler is logged and does not stop
 * the close.
 *
 * `close()` before the refusal runs turns it into a close without the error.
 * The close still fires, because y-websocket 2.0.0 clears `provider.ws` only in
 * `onclose`, and `connect()` dials only while `provider.ws` is null. Tests:
 * `test/provider-reconnect.test.ts` N7, N11; `test/provider-auth.test.ts`
 * "refuses the dial without building a socket when the resolver throws",
 * "fires only the close for a refused dial closed before the refusal runs" and
 * "fires the events of a refused dial to its listeners".
 */
class RefusedDial extends EventTarget implements WebSocket {
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

	constructor(url: string, reason: RefusalReason) {
		super();
		this.url = url;
		queueMicrotask(() => {
			this.refuse(reason);
		});
	}

	private refuse(reason: RefusalReason): void {
		const cancelled = this.readyState === this.CLOSING;
		this.readyState = this.CLOSED;
		if (!cancelled) {
			const error = new Event('error');
			runHandler(() => {
				this.onerror?.(error);
			});
			this.dispatchEvent(error);
		}
		const close = Object.assign(new Event('close'), {
			code: 1006,
			reason,
			wasClean: false,
		});
		runHandler(() => {
			this.onclose?.(close);
		});
		this.dispatchEvent(close);
	}

	close(): void {
		if (this.readyState === this.CONNECTING) this.readyState = this.CLOSING;
	}

	send(): void {
		// Never opens, and y-websocket sends only after `onopen`.
	}
}

/**
 * Logs a refused dial, with the label of the thrown value when something threw,
 * and returns a socket that dials nothing.
 */
function refuseDial(url: string, refusal: Refusal): WebSocket {
	const line = `[sentio] collab: ${refusal.reason}; dial refused`;
	if ('cause' in refusal) console.error(`${line}:`, errorLabel(refusal.cause));
	else console.error(line);
	return new RefusedDial(url, refusal.reason);
}

/**
 * What one dial of the binding whose socket class is `self` does. While another
 * binding is active it passes the dial through. It refuses the dial when the
 * resolver throws, and when the resolver replaced or removed this binding, so
 * no credentials of a stale binding go out and the next dial, after the
 * backoff, goes through the binding active then. It also refuses a token that
 * cannot go on the wire: a subprotocol entry outside `PROTOCOL_TOKEN`, or a
 * lone surrogate, on which `encodeURIComponent` throws `URIError`. Otherwise it
 * dials with the resolved auth added. Tests: `test/provider-auth.test.ts`
 * "refuses the dial when the resolver replaces its binding" and "refuses a dial
 * whose token cannot be encoded".
 */
function planDial(
	slot: BindingSlot,
	self: SocketConstructor,
	auth: AuthBinding | string | (() => string | null | undefined),
	url: string,
	protocols: string | string[] | undefined,
): DialPlan {
	if (!isActive(slot, self)) return PASS_THROUGH;
	let resolved: ResolvedAuth;
	try {
		resolved = resolveAuthParams(auth);
	} catch (cause) {
		return { kind: 'refuse', refusal: { reason: 'auth token resolver threw', cause } };
	}
	if (!isActive(slot, self)) {
		return {
			kind: 'refuse',
			refusal: { reason: 'auth binding replaced while its token resolved' },
		};
	}
	if (!resolved.protocols.every((entry) => PROTOCOL_TOKEN.test(entry))) {
		return { kind: 'refuse', refusal: { reason: 'auth token cannot be encoded for the dial' } };
	}
	try {
		const dial = dialUrl(url, resolved.params);
		return { kind: 'dial', url: dial, protocols: dialProtocols(protocols, resolved.protocols) };
	} catch (cause) {
		return {
			kind: 'refuse',
			refusal: { reason: 'auth token cannot be encoded for the dial', cause },
		};
	}
}

/**
 * Subclass of `Base` that resolves `auth` as each socket is built, the last
 * point a fresh token can still reach the dial: y-websocket builds every socket
 * with `new provider._WS(provider.url, provider.protocols)` (`setupWS` in
 * y-websocket 3.1.0 `src/y-websocket.js`). Nothing is written to the provider,
 * so its `params` and `protocols` keep caller entries only. `planDial` decides
 * whether the dial passes through, is refused, or carries the token.
 */
function authSocket(
	slot: BindingSlot,
	Base: SocketConstructor,
	auth: AuthBinding | string | (() => string | null | undefined),
): SocketConstructor {
	const AuthSocket = class extends Base {
		constructor(url: string | URL, protocols?: string | string[]) {
			const plan = planDial(slot, AuthSocket, auth, String(url), protocols);
			if (plan.kind === 'refuse') return refuseDial(String(url), plan.refusal);
			if (plan.kind === 'dial') super(plan.url, plan.protocols);
			else super(url, protocols);
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
 * passes dials through; a dial whose resolver replaces its binding is refused
 * (see `planDial`). The returned unbind stops this binding and puts back
 * the socket constructor it wrapped, unless something has wrapped it since.
 * Tests: the `bindProviderAuth` block in `test/provider-auth.test.ts`.
 */
export function bindProviderAuth(
	provider: AuthBindableProvider,
	auth: AuthBinding | string | (() => string | null | undefined),
): () => void {
	const Base = provider._WS as SocketConstructor | undefined;
	if (typeof Base !== 'function') {
		console.error(
			'[sentio] collab: provider has no _WS socket constructor; auth not bound, dials carry no token',
		);
		return () => {
			// Nothing was bound.
		};
	}
	const slot = provider as AuthBindableProvider & BindingSlot;
	const AuthSocket = authSocket(slot, Base, auth);
	slot[ACTIVE_BINDING] = AuthSocket;
	provider._WS = AuthSocket;
	return () => {
		if (slot[ACTIVE_BINDING] === AuthSocket) slot[ACTIVE_BINDING] = undefined;
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
