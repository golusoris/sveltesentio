import type * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { ProblemError } from '@sveltesentio/core/problem';
import { dialProtocols, dialUrl, exceedsEntryBound } from './internal/dial-url.js';
import { errorLabel, rejectsDial } from './internal/error-label.js';
import { haltDials, stopProvider, stopUnboundDial } from './internal/stop-provider.js';

export type ProviderStatus = 'disconnected' | 'connecting' | 'connected';

/**
 * RFC 9457 problem type of the `ProblemError` `connectProvider` throws when
 * `auth` is set but cannot be bound to the provider's socket constructor, or
 * has no transport (`param: null` with no `protocol`).
 */
export const COLLAB_AUTH_NOT_BOUND_TYPE = 'https://sveltesentio.dev/problems/collab/auth-not-bound';

/**
 * RFC 9457 problem type of the `ProblemError` `connectProvider` throws when the
 * first dial it starts throws, the thrown value then being its `cause`, or is
 * refused permanently, which stops the provider (`PERMANENT_REFUSALS`).
 */
export const COLLAB_START_FAILED_TYPE = 'https://sveltesentio.dev/problems/collab/start-failed';

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
	 * `''` attaches no token; the caller params still go out, a fallback under
	 * `param` included, so the dial is anonymous only when the caller params
	 * carry no credential (see `param`). A throw refuses that dial: no
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
	 * query-param transport when `protocol` carries the token; with `protocol`
	 * unset too the token has no transport, and the binding is refused
	 * (`bindAuth`).
	 * While a token resolves it replaces a caller param under the same key; while
	 * none does, the caller param is sent, so a caller value under this key is a
	 * fallback such as a guest token, never a copy of the session token.
	 *
	 * The URL, this pair included, reaches every server, proxy and tracer on the
	 * way, and those commonly log request URLs, so a token sent here can land in
	 * their logs. Redact this key wherever URLs are logged, or set `param: null`
	 * and send the token with `protocol` alone. Making the query transport
	 * opt-in is tracked in #585.
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
	/**
	 * Called on every status change. A throw is logged and the provider keeps
	 * reconnecting, except during the first dial `connectProvider` starts: then
	 * the provider is torn down and the caller gets a `ProblemError` of type
	 * `COLLAB_START_FAILED_TYPE` whose `cause` is the thrown value.
	 */
	readonly onStatusChange?: (status: ProviderStatus) => void;
	/** Called when the sync state changes. A throw is logged and the provider keeps reconnecting. */
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
	return readAuth(auth).resolved;
}

/**
 * `resolveAuthParams` with `bare` set when a non-empty token has neither a
 * query key nor a subprotocol to travel in. `param` and `protocol` are read
 * once each, so a getter that changes between reads cannot split the decision.
 * Tests: `test/provider-auth.test.ts` "refuses a dial whose binding lost its
 * transport after binding".
 */
function readAuth(auth: AuthBinding | string | (() => string | null | undefined)): {
	readonly resolved: ResolvedAuth;
	readonly bare: boolean;
} {
	const binding = toAuthBinding(auth);
	const token = typeof binding.token === 'function' ? binding.token() : binding.token;
	if (token === null || token === undefined || token === '') {
		return { resolved: { params: {}, protocols: [] }, bare: false };
	}
	const { param, protocol } = binding;
	const key = param === undefined ? 'token' : param;
	// `Object.fromEntries` defines an own property, so a `param` of `'__proto__'`
	// stays a key instead of setting the prototype (`test/provider-auth.test.ts`
	// "keeps a __proto__ param as a query key").
	const params = Object.fromEntries(key === null ? [] : [[key, token]]);
	const protocols: string[] = [];
	if (protocol !== undefined) protocols.push(`${protocol}.${token}`);
	return { resolved: { params, protocols }, bare: key === null && protocol === undefined };
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
 * assignable. The peer floor is 2.0.4, the first release that passes the
 * caller's `protocols` to `_WS`; earlier ones dial `new _WS(url)` alone, so a
 * protocol-only auth dial would drop the caller subprotocols. A provider that reaches `bindProviderAuth` without `_WS` anyway,
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
	[ACTIVE_BINDING]?: unknown;
}

/** Whether the binding whose socket class is `self` is the one active on `slot`. */
function isActive(slot: BindingSlot, self: SocketConstructor): boolean {
	return Reflect.get(slot, ACTIVE_BINDING) === self;
}

/**
 * The constructor a new binding wraps: the one under `current` when `current`
 * is the active binding's socket class, else `current` itself. A rebind then
 * replaces the active layer instead of stacking on it, so repeated rebinds keep
 * one auth layer and hold no closure of a replaced binding. A constructor
 * something else has wrapped around a binding stays, since this module cannot
 * remove a layer it did not put on top. Tests: `test/provider-auth.test.ts`
 * "keeps one auth layer across rebinds" and "keeps a wrapper put over a
 * binding".
 */
function innerSocket(slot: BindingSlot, current: SocketConstructor): SocketConstructor {
	return isActive(slot, current) ? (Object.getPrototypeOf(current) as SocketConstructor) : current;
}

/** Why a dial was refused; also the reason of its close event. */
type RefusalReason =
	| 'auth token resolver threw'
	| 'auth binding replaced while its token resolved'
	| 'auth binding has no transport for its token'
	| 'auth token cannot be encoded for the dial'
	| 'dial exceeds the query pair or subprotocol bound'
	| 'socket constructor rejected the dial'
	| 'socket constructor threw';

/**
 * Refusals the next dial would meet again, so y-websocket's reconnect would
 * retry them forever: a socket constructor rejecting the caller's URL or
 * subprotocols with a `SyntaxError` (`rejectsDial`), and a dial over the entry
 * bound. Such a refusal stops the provider (`haltDials`). The others depend on
 * the token, the binding or the moment, a socket constructor throwing anything
 * else included, and are retried after the backoff. Tests:
 * `test/provider-auth.test.ts` "stops the provider on a dial the socket
 * constructor rejects" and "retries a dial the socket constructor throws on
 * with another error".
 */
const PERMANENT_REFUSALS: ReadonlySet<RefusalReason> = new Set<RefusalReason>([
	'dial exceeds the query pair or subprotocol bound',
	'socket constructor rejected the dial',
]);

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
 * `subprotocolRegex` in `ws` 8.22.0 `lib/websocket.js`. Without the `m` flag,
 * `$` matches only at the end of the input (ECMA-262, `Assertion :: $`), so an entry
 * ending in a line terminator fails. Tests: `test/provider-auth.test.ts`
 * "refuses a token ending in a line terminator".
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
 * replaced while the token resolved, the token cannot be encoded, the dial is
 * over the entry bound, or the socket constructor threw on it. It opens
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
 * The close still fires, because y-websocket (2.0.4 to 3.1.0) clears
 * `provider.ws` only in `onclose`, and `connect()` dials only while
 * `provider.ws` is null. Tests:
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
	/** Why the dial was refused. */
	readonly reason: RefusalReason;
	/** Whether the refusal stopped the provider (`PERMANENT_REFUSALS`). */
	readonly halted: boolean;
	binaryType: BinaryType = 'blob';
	readyState: WebSocket['readyState'] = this.CONNECTING;
	onclose: WebSocket['onclose'] = null;
	onerror: WebSocket['onerror'] = null;
	onmessage: WebSocket['onmessage'] = null;
	onopen: WebSocket['onopen'] = null;

	constructor(url: string, reason: RefusalReason, halted: boolean) {
		super();
		this.url = url;
		this.reason = reason;
		this.halted = halted;
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
 * and returns a socket that dials nothing. A permanent refusal also stops
 * `provider` (`PERMANENT_REFUSALS`), and the log says whether it did.
 */
function refuseDial(provider: object, url: string, refusal: Refusal): WebSocket {
	const halted = PERMANENT_REFUSALS.has(refusal.reason) && haltDials(provider);
	let outcome = 'dial refused';
	if (halted) outcome = 'dial refused, provider stopped until connect() is called';
	else if (PERMANENT_REFUSALS.has(refusal.reason)) outcome = 'dial refused, provider not stopped';
	const line = `[sentio] collab: ${refusal.reason}; ${outcome}`;
	if ('cause' in refusal) console.error(`${line}:`, errorLabel(refusal.cause));
	else console.error(line);
	return new RefusedDial(url, refusal.reason, halted);
}

/**
 * What one dial of a binding does; `active` tells whether that binding still
 * injects. While it does not, the dial passes through. It refuses the dial when
 * the resolver throws, and when the resolver replaced or removed this binding,
 * so no credentials of a stale binding go out and the next dial, after the
 * backoff, goes through the binding active then. It refuses a token the
 * binding no longer gives a query key or subprotocol, as a binding changed
 * after `bindProviderAuth` checked it can (`readAuth`), so no dial goes out
 * without the credential, and retries after the backoff. It also refuses a token that
 * cannot go on the wire: a subprotocol entry outside `PROTOCOL_TOKEN`, or a
 * lone surrogate, on which `encodeURIComponent` throws `URIError`, and a dial
 * over `MAX_DIAL_ENTRIES`, checked before resolving anything and again with
 * the auth entries added. Otherwise it dials with the resolved auth added.
 * Tests: `test/provider-auth.test.ts` "refuses the dial when the resolver
 * replaces its binding", "refuses a dial whose token cannot be encoded" and
 * "refuses a dial over the entry bound".
 */
function planDial(
	active: () => boolean,
	auth: AuthBinding | string | (() => string | null | undefined),
	url: string,
	protocols: string | string[] | undefined,
): DialPlan {
	if (!active()) return PASS_THROUGH;
	if (exceedsEntryBound(url, protocols)) {
		return {
			kind: 'refuse',
			refusal: { reason: 'dial exceeds the query pair or subprotocol bound' },
		};
	}
	let read: ReturnType<typeof readAuth>;
	try {
		read = readAuth(auth);
	} catch (cause) {
		return { kind: 'refuse', refusal: { reason: 'auth token resolver threw', cause } };
	}
	if (!active()) {
		return {
			kind: 'refuse',
			refusal: { reason: 'auth binding replaced while its token resolved' },
		};
	}
	if (read.bare) {
		return { kind: 'refuse', refusal: { reason: 'auth binding has no transport for its token' } };
	}
	const { resolved } = read;
	if (!resolved.protocols.every((entry) => PROTOCOL_TOKEN.test(entry))) {
		return { kind: 'refuse', refusal: { reason: 'auth token cannot be encoded for the dial' } };
	}
	return authDial(url, protocols, resolved);
}

/**
 * The dial with `resolved` added, or a refusal: a key or value that
 * `encodeURIComponent` rejects, or auth entries that take the query pairs or
 * the subprotocols over `MAX_DIAL_ENTRIES`, as an auth pair or subprotocol
 * added to a caller list already at the bound does. Tests:
 * `test/provider-auth.test.ts` "refuses a dial over the entry bound, auth
 * entries counted".
 */
function authDial(
	url: string,
	protocols: string | string[] | undefined,
	resolved: ResolvedAuth,
): DialPlan {
	let dial: string;
	try {
		dial = dialUrl(url, resolved.params);
	} catch (cause) {
		return {
			kind: 'refuse',
			refusal: { reason: 'auth token cannot be encoded for the dial', cause },
		};
	}
	const list = dialProtocols(protocols, resolved.protocols);
	if (exceedsEntryBound(dial, list)) {
		return {
			kind: 'refuse',
			refusal: { reason: 'dial exceeds the query pair or subprotocol bound' },
		};
	}
	return { kind: 'dial', url: dial, protocols: list };
}

/**
 * Subclass of `Base` that resolves `auth` as each socket is built, the last
 * point a fresh token can still reach the dial: y-websocket builds every socket
 * with `new provider._WS(provider.url, provider.protocols)` (`setupWS` in
 * y-websocket 3.1.0 `src/y-websocket.js`). Nothing is written to the provider,
 * so its `params` and `protocols` keep caller entries only. `planDial` decides
 * whether the dial passes through, is refused, or carries the token. A throw
 * from `Base` on a dial carrying the token refuses that dial instead of
 * escaping into y-websocket's `setupWS`, where it would stop every later
 * reconnect; a `SyntaxError` also stops the provider, since the next dial
 * would meet it again (`PERMANENT_REFUSALS`). A pass-through dial behaves as
 * without the binding.
 * The binding injects while `state.active` is set and it holds the provider's
 * active-binding slot; unbind clears `state.active`, so it stops also on a
 * provider frozen after binding. Tests: `test/provider-auth.test.ts` "stops
 * the provider on a dial the socket constructor rejects" and "stops injecting
 * after unbind on a provider frozen after binding".
 */
function authSocket(
	slot: BindingSlot,
	Base: SocketConstructor,
	auth: AuthBinding | string | (() => string | null | undefined),
	state: { active: boolean },
): SocketConstructor {
	const AuthSocket = class extends Base {
		constructor(url: string | URL, protocols?: string | string[]) {
			const active = (): boolean => state.active && isActive(slot, AuthSocket);
			const plan = planDial(active, auth, String(url), protocols);
			if (plan.kind === 'refuse') return refuseDial(slot, String(url), plan.refusal);
			if (plan.kind === 'pass') {
				super(url, protocols);
				return;
			}
			try {
				super(plan.url, plan.protocols);
			} catch (cause) {
				const reason = rejectsDial(cause)
					? 'socket constructor rejected the dial'
					: 'socket constructor threw';
				return refuseDial(slot, String(url), { reason, cause });
			}
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
 * (see `planDial`). The new binding wraps the constructor under the active one
 * (`innerSocket`), so rebinds do not stack. The returned unbind stops this
 * binding and puts back the socket constructor it wrapped, unless something
 * has wrapped it since; it stops injecting also when the provider was frozen
 * after binding. A `_WS` that is missing, cannot be subclassed (an arrow
 * function, a bound function) or is read-only, a sealed or frozen provider,
 * and a binding with `param: null` and no `protocol`, bind nothing; the
 * provider is stopped (`stopProvider`) and a `console.error` names why, so it
 * dials no further without the token until the caller calls `connect()`
 * again. `connectProvider` instead destroys its provider and throws
 * (`bindOrDestroy`).
 *
 * Bind before the first dial: construct the provider with `connect: false`,
 * bind, then call `provider.connect()`, as `connectProvider` does. y-websocket
 * dials while it is constructed unless `connect` is `false`, and that request
 * goes out without the token. A first binding finding such a socket stops the
 * provider, closing that socket, and logs a `console.error`; the binding is
 * installed, so the next `connect()` dials with the token (`stopUnboundDial`).
 * Tests: the `bindProviderAuth` blocks in `test/provider-auth.test.ts`;
 * `test/provider-reconnect.test.ts` N17.
 */
export function bindProviderAuth(
	provider: AuthBindableProvider,
	auth: AuthBinding | string | (() => string | null | undefined),
): () => void {
	const bound = tryBind(provider, auth);
	if (typeof bound !== 'string') return bound;
	const left = stopProvider(provider);
	const outcome = left === undefined ? 'provider stopped' : `provider not stopped: ${left}`;
	console.error(`[sentio] collab: ${bound}; auth not bound, ${outcome}`);
	return () => {
		// Nothing was bound.
	};
}

/**
 * `bindAuth`, with a throw while it reads or writes the provider or the
 * binding (a getter, a setter or a proxy trap) turned into the reason nothing
 * was bound, so the caller refuses and stops the provider as for any other.
 * Tests: `test/provider-auth.test.ts` "binds nothing when reading the provider
 * throws".
 */
function tryBind(
	provider: AuthBindableProvider,
	auth: AuthBinding | string | (() => string | null | undefined),
): (() => void) | string {
	try {
		return bindAuth(provider, auth);
	} catch (error) {
		return `reading the auth binding or the provider threw (${errorLabel(error)})`;
	}
}

/**
 * Binds `auth` as `bindProviderAuth` documents and returns the unbind, or
 * returns why nothing was bound: the binding has no transport, `_WS` is
 * missing, cannot be subclassed or is read-only, or the provider takes no
 * binding slot. The unbind clears the binding's `state.active` first, then
 * writes the slot and `_WS` back with `Reflect.set`, which on a provider
 * frozen since returns `false` instead of throwing. The unbind never throws:
 * a getter, setter or proxy trap that throws while it writes back is logged
 * with `console.error`, and the binding adds no token either way, so a
 * caller's teardown after it (`connectProvider`'s `disconnect`) still runs.
 * Tests: `test/provider-auth.test.ts` "unbind does not throw when writing the
 * provider back throws".
 */
function bindAuth(
	provider: AuthBindableProvider,
	auth: AuthBinding | string | (() => string | null | undefined),
): (() => void) | string {
	const binding = toAuthBinding(auth);
	if (binding.param === null && binding.protocol === undefined) {
		return 'auth binding has no transport (param is null and protocol is unset)';
	}
	const current: unknown = provider._WS;
	if (typeof current !== 'function') return 'provider has no _WS socket constructor';
	const slot = provider as AuthBindableProvider & BindingSlot;
	const Base = innerSocket(slot, current as SocketConstructor);
	const state = { active: true };
	let AuthSocket: SocketConstructor;
	try {
		AuthSocket = authSocket(slot, Base, auth, state);
	} catch (error) {
		return `provider _WS cannot be subclassed (${errorLabel(error)})`;
	}
	const refused = installBinding(slot, AuthSocket);
	if (refused !== undefined) return refused;
	return () => {
		state.active = false;
		try {
			if (isActive(slot, AuthSocket)) Reflect.set(slot, ACTIVE_BINDING, undefined);
			if (Reflect.get(slot, '_WS') === AuthSocket) Reflect.set(slot, '_WS', Base);
		} catch (error) {
			console.error(`[sentio] collab: unbind threw (${errorLabel(error)}); no token is added`);
		}
	};
}

/**
 * Makes `AuthSocket` the active binding and the provider's `_WS`, reading each
 * write back, or returns why it could not. A sealed or frozen provider takes no
 * new slot, so `isActive` would never match and every dial would pass through
 * without the token; a read-only `_WS` keeps its constructor, and the slot
 * then gets its earlier value back, so nothing is left half bound. A write
 * that throws, that rollback included, reaches `tryBind`, so the binding is
 * refused and the caller stops the provider; an earlier binding whose slot
 * could not be written back then adds no token, as for any refused direct
 * binding (#589). On a first binding, a provider that already dialed is
 * stopped (`stopUnboundDial`). Tests: `test/provider-auth.test.ts` "binds
 * nothing on a sealed provider", "binds nothing and keeps the earlier binding
 * when _WS is read-only" and "refuses and stops the provider when rolling a
 * rebind back throws".
 */
function installBinding(
	slot: AuthBindableProvider & BindingSlot,
	AuthSocket: SocketConstructor,
): string | undefined {
	const previous: unknown = Reflect.get(slot, ACTIVE_BINDING);
	Reflect.set(slot, ACTIVE_BINDING, AuthSocket);
	if (!isActive(slot, AuthSocket)) return 'provider takes no binding slot (sealed or frozen)';
	const refused = writeSocket(slot, AuthSocket);
	if (refused !== undefined) {
		Reflect.set(slot, ACTIVE_BINDING, previous);
		return refused;
	}
	if (previous === undefined) stopUnboundDial(slot);
	return undefined;
}

/** Writes `AuthSocket` to `_WS` and reads it back, or returns why it did not hold. */
function writeSocket(slot: object, AuthSocket: SocketConstructor): string | undefined {
	try {
		Reflect.set(slot, '_WS', AuthSocket);
		return Reflect.get(slot, '_WS') === AuthSocket ? undefined : 'provider _WS is read-only';
	} catch (error) {
		return `writing provider _WS threw (${errorLabel(error)})`;
	}
}

/**
 * Binds `auth` to the provider `connectProvider` built, or fails closed: when
 * no binding can be made (a `WebSocketPolyfill` that cannot be subclassed) the
 * provider is destroyed before any dial and a `ProblemError` of type
 * `COLLAB_AUTH_NOT_BOUND_TYPE` is thrown, also with `connect: false`, so no
 * later `provider.connect()` dials without the token. Tests:
 * `test/provider-auth.test.ts` "throws instead of connecting without auth".
 */
function bindOrDestroy(
	provider: WebsocketProvider,
	auth: AuthBinding | string | (() => string | null | undefined),
): () => void {
	const bound = tryBind(provider, auth);
	if (typeof bound !== 'string') return bound;
	provider.destroy();
	throw new ProblemError({
		type: COLLAB_AUTH_NOT_BOUND_TYPE,
		title: 'Collab auth not bound',
		detail: `${bound}; the provider was destroyed before any dial`,
	});
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
 * Whether a caller callback's throw reaches the code that started the event.
 * Set only while `startOrTearDown` runs the first dial.
 */
interface CallbackGuard {
	surfacing: boolean;
}

/**
 * Runs a caller callback with its throws kept out of y-websocket. y-websocket
 * calls status and sync listeners inside its close handler and inside
 * `connect()`, ahead of scheduling or building the next socket
 * (`closeWebsocketConnection` and `setupWS` in y-websocket 3.1.0
 * `src/y-websocket.js`), so a throw that escaped there would stop every later
 * reconnect. A throw is logged by its label alone (`errorLabel`) and the
 * provider carries on; only while `guard.surfacing` is set does it propagate,
 * to `startOrTearDown`. Tests: `test/provider-reconnect.test.ts` N13, N14, N15.
 */
function runGuarded(guard: CallbackGuard, name: string, call: () => void): void {
	try {
		call();
	} catch (error) {
		if (guard.surfacing) throw error;
		console.error(`[sentio] collab: ${name} callback threw:`, errorLabel(error));
	}
}

/**
 * Subscribes the optional status and sync callbacks, returning the matching detach.
 *
 * Pairing attach with detach here keeps the two lists from drifting apart:
 * previously `connectProvider` registered each listener in one place and removed it
 * in another, so a listener added without a matching `off` would outlive
 * `disconnect()`. Both callbacks run through `runGuarded`.
 */
function bindProviderEvents(
	provider: WebsocketProvider,
	guard: CallbackGuard,
	onStatusChange?: (status: ProviderStatus) => void,
	onSync?: (synced: boolean) => void,
): () => void {
	const handleStatus = onStatusChange
		? ({ status: next }: { status: string }) => {
				runGuarded(guard, 'onStatusChange', () => {
					onStatusChange(normaliseStatus(next));
				});
			}
		: undefined;
	const handleSync = onSync
		? (synced: boolean) => {
				runGuarded(guard, 'onSync', () => {
					onSync(synced);
				});
			}
		: undefined;
	if (handleStatus) provider.on('status', handleStatus);
	if (handleSync) provider.on('sync', handleSync);
	return () => {
		if (handleStatus) provider.off('status', handleStatus);
		if (handleSync) provider.off('sync', handleSync);
	};
}

/**
 * Starts the first dial. y-websocket emits `'connecting'` synchronously inside
 * `connect()`; a throwing `onStatusChange` there propagates (`guard.surfacing`),
 * the provider is torn down and the caller of `connectProvider` gets a
 * `ProblemError` of type `COLLAB_START_FAILED_TYPE` with the thrown value as
 * its `cause`; its `detail` names only the value's label (`errorLabel`). Later
 * throws are logged (`runGuarded`). A first dial refused permanently, which
 * stopped the provider (`PERMANENT_REFUSALS`), tears it down the same way and
 * throws a `ProblemError` of that type naming the refusal, so a configuration
 * every dial would fail on surfaces to the caller. Tests:
 * `test/provider-reconnect.test.ts` N8, N13, N18, N20.
 */
function startOrTearDown(
	provider: WebsocketProvider,
	guard: CallbackGuard,
	teardown: () => void,
): void {
	guard.surfacing = true;
	try {
		provider.connect();
	} catch (error) {
		guard.surfacing = false;
		teardown();
		throw new ProblemError({
			type: COLLAB_START_FAILED_TYPE,
			title: 'Collab provider start failed',
			detail: `the first dial threw (${errorLabel(error)}); the provider was torn down`,
			cause: error,
		});
	} finally {
		guard.surfacing = false;
	}
	const { ws } = provider;
	if (!(ws instanceof RefusedDial) || !ws.halted) return;
	teardown();
	throw new ProblemError({
		type: COLLAB_START_FAILED_TYPE,
		title: 'Collab provider start failed',
		detail: `the first dial was refused (${ws.reason}); the provider was torn down`,
	});
}

/**
 * Builds a `WebsocketProvider` for `room` with status normalisation, guarded
 * callbacks and, when `auth` is set, a token on every dial (`bindProviderAuth`).
 * Throws a `ProblemError` of type `COLLAB_AUTH_NOT_BOUND_TYPE` when `auth` is
 * set but cannot be bound (`bindOrDestroy`), and one of type
 * `COLLAB_START_FAILED_TYPE` when the first dial throws or is refused
 * permanently (`startOrTearDown`). Turning a socket constructor throw on a
 * reconnect into a refused dial (`RefusedDial`, `PERMANENT_REFUSALS`) is part
 * of the auth binding, so it covers auth-bound providers only; without `auth`
 * the socket constructor is y-websocket's own, as without this package.
 */
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

	const unbindAuth = auth === undefined ? undefined : bindOrDestroy(provider, auth);

	const guard: CallbackGuard = { surfacing: false };
	const unbindEvents = bindProviderEvents(provider, guard, onStatusChange, onSync);

	// The provider is destroyed even when an unbind throws, so it never stays live
	// with a binding that adds no token.
	const disconnect = (): void => {
		try {
			if (unbindAuth) unbindAuth();
			unbindEvents();
		} finally {
			provider.disconnect();
			provider.destroy();
		}
	};

	if (options.connect !== false) startOrTearDown(provider, guard, disconnect);

	return { provider, disconnect };
}

function normaliseStatus(status: string): ProviderStatus {
	if (status === 'connected') return 'connected';
	if (status === 'connecting') return 'connecting';
	return 'disconnected';
}
