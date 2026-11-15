import type * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { ProblemError } from '@sveltesentio/core/problem';
import { dialProtocols, dialUrl, exceedsEntryBound } from './internal/dial-url.js';
import { errorLabel, rejectsDial } from './internal/error-label.js';
import {
	type RefusalReason,
	type Refusal,
	RefusedDial,
	refuseDial,
} from './internal/refused-dial.js';
import { stopProvider, stopUnboundDial } from './internal/stop-provider.js';

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
	 * sends the token current at that moment; a method is called on its binding,
	 * so it can read `this`. Returning `null` / `undefined` /
	 * `''` attaches no token; the caller params still go out, a fallback under
	 * `param` included, so the dial is anonymous only when the caller params
	 * carry no credential (see `param`). A throw refuses that dial: no
	 * request goes out, the error is logged by its label only, y-websocket's
	 * `connection-error` gets a plain `error` event without the thrown value, as
	 * for a refused connection, and the provider dials again after its backoff.
	 * A token that cannot go on the wire refuses the dial the same way: one with
	 * a lone UTF-16 surrogate, which `encodeURIComponent` rejects, or a
	 * subprotocol entry outside the RFC 6455 token characters. A string token
	 * is fixed, so every dial would meet the same refusal: it also stops the
	 * provider until `connect()` is called, and `connectProvider` throws a
	 * `ProblemError` of type `COLLAB_START_FAILED_TYPE` on the first dial.
	 * Tests: `test/provider-reconnect.test.ts` P4, P6, N7, N23;
	 * `test/provider-auth.test.ts` "refuses a dial whose token cannot be
	 * encoded" and "stops the provider on a fixed token that cannot be encoded".
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
	/**
	 * Detaches the callbacks, then disconnects and destroys the provider; the
	 * destroy runs even when an earlier step throws, and the throw still reaches
	 * the caller. With `auth` set the binding then refuses every dial, so a
	 * `provider.connect()` after `disconnect` sends nothing, with or without
	 * the token. Tests: `test/provider-reconnect.test.ts` N21, N22.
	 */
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
	readonly fixed: boolean;
} {
	const binding = toAuthBinding(auth);
	const source = binding.token;
	const fixed = typeof source !== 'function';
	// Called on the binding, so a `token` method reading `this` keeps its
	// receiver (`test/provider-auth.test.ts` "calls a token method on its binding").
	const token = fixed ? source : source.call(binding);
	if (token === null || token === undefined || token === '') {
		return { resolved: { params: {}, protocols: [] }, bare: false, fixed };
	}
	const { param, protocol } = binding;
	const key = param === undefined ? 'token' : param;
	// `Object.fromEntries` defines an own property, so a `param` of `'__proto__'`
	// stays a key instead of setting the prototype (`test/provider-auth.test.ts`
	// "keeps a __proto__ param as a query key").
	const params = Object.fromEntries(key === null ? [] : [[key, token]]);
	const protocols: string[] = [];
	if (protocol !== undefined) protocols.push(`${protocol}.${token}`);
	return { resolved: { params, protocols }, bare: key === null && protocol === undefined, fixed };
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
 * keeps no mutable state (`docs/principles.md` §2.1, row 6). The key comes from
 * the global symbol registry (`Symbol.for`), so two copies of this package
 * loaded side by side (two bundles, a duplicated dependency) share the slot and
 * a rebind through either copy replaces the other's binding instead of
 * stacking on it. The `@1` names the slot layout, so a copy that changes it
 * takes another key. Tests: `test/provider-auth.test.ts` "lets only the latest
 * binding inject", "keeps the binding of each provider apart" and "lets a
 * second loaded copy replace the binding of the first".
 */
const ACTIVE_BINDING: unique symbol = Symbol.for('@sveltesentio/collab/activeBinding@1');

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
 * the auth entries added. A fixed (string) token that cannot go on the wire
 * gets its own reason, a permanent refusal, since every later dial would
 * carry the same token. Otherwise it dials with the resolved auth added.
 * Tests: `test/provider-auth.test.ts` "refuses the dial when the resolver
 * replaces its binding", "refuses a dial whose token cannot be encoded",
 * "stops the provider on a fixed token that cannot be encoded" and "refuses a
 * dial over the entry bound".
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
	const unencodable: RefusalReason = read.fixed
		? 'fixed auth token cannot be encoded for the dial'
		: 'auth token cannot be encoded for the dial';
	if (!resolved.protocols.every((entry) => PROTOCOL_TOKEN.test(entry))) {
		return { kind: 'refuse', refusal: { reason: unencodable } };
	}
	return authDial(url, protocols, resolved, unencodable);
}

/**
 * `planDial` for the binding holding `state`, refused with its close reason
 * when the binding was closed before the dial or while its token resolved: a
 * resolver that calls `connectProvider`'s `disconnect` closes the binding but
 * leaves it active, so without the second read the dial would still be built
 * after the teardown. A throw from `planDial` refuses the dial instead of
 * escaping into y-websocket's `setupWS`, where it would stop every later
 * reconnect: the resolver's throws are caught in `planDial`, so what reaches
 * here is a check of the binding, such as the read of the provider's
 * active-binding slot (`isActive`) when a getter or proxy trap on it throws.
 * The dial is retried after the backoff, not refused for good, since the read
 * may hold next time. Tests: `test/provider-reconnect.test.ts` N25;
 * `test/provider-auth.test.ts` "refuses the dial when reading the binding slot
 * throws".
 */
function planBoundDial(
	state: BindingState,
	active: () => boolean,
	auth: AuthBinding | string | (() => string | null | undefined),
	url: string,
	protocols: string | string[] | undefined,
): DialPlan {
	const before = state.closed;
	if (before !== undefined) return { kind: 'refuse', refusal: { reason: before } };
	let plan: DialPlan;
	try {
		plan = planDial(active, auth, url, protocols);
	} catch (cause) {
		plan = { kind: 'refuse', refusal: { reason: 'auth binding check threw', cause } };
	}
	const after = state.closed;
	return after === undefined ? plan : { kind: 'refuse', refusal: { reason: after } };
}

/**
 * The dial with `resolved` added, or a refusal: a key or value that
 * `encodeURIComponent` rejects (refused with `unencodable`), or auth entries
 * that take the query pairs or the subprotocols over `MAX_DIAL_ENTRIES`, as
 * an auth pair or subprotocol added to a caller list already at the bound
 * does. Tests:
 * `test/provider-auth.test.ts` "refuses a dial over the entry bound, auth
 * entries counted".
 */
function authDial(
	url: string,
	protocols: string | string[] | undefined,
	resolved: ResolvedAuth,
	unencodable: RefusalReason,
): DialPlan {
	let dial: string;
	try {
		dial = dialUrl(url, resolved.params);
	} catch (cause) {
		return { kind: 'refuse', refusal: { reason: unencodable, cause } };
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
 * Whether a binding still injects (`active`) and, once it refuses every dial,
 * why (`closed`).
 */
interface BindingState {
	active: boolean;
	closed?: RefusalReason;
}

/**
 * Key of the static field on a binding's socket class holding its
 * `BindingState`, so a binding installed as `_WS` can be closed through the
 * class even when the provider no longer takes writes (`closeInstalledBinding`).
 * The field lives on the class this module builds, not on the provider. The key
 * is a registry symbol for the same reason as `ACTIVE_BINDING`: a second copy
 * of this package closes a binding the first installed.
 */
const BINDING_STATE = Symbol.for('@sveltesentio/collab/bindingState@1');

/**
 * Closes the binding installed as the provider's `_WS`, or the one a wrapper
 * there extends, so every later dial through it is refused, and says whether
 * there was one. A read that throws counts as none. Tests:
 * `test/provider-auth.test.ts` "closes the earlier binding when a refused
 * rebind cannot stop the provider".
 */
function closeInstalledBinding(provider: object): boolean {
	try {
		const socket: unknown = Reflect.get(provider, '_WS');
		const state: unknown =
			typeof socket === 'function' ? Reflect.get(socket, BINDING_STATE) : undefined;
		if (typeof state !== 'object' || state === null) return false;
		(state as BindingState).closed = 'auth binding closed by a refused rebind';
		return true;
	} catch {
		return false;
	}
}

/**
 * A made binding: `unbind` stops it and puts the wrapped socket constructor
 * back (`bindProviderAuth`); `close` keeps it installed and makes it refuse
 * every later dial (`connectProvider`'s `disconnect`). Neither throws.
 */
interface BoundAuth {
	readonly unbind: () => void;
	readonly close: () => void;
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
 * provider frozen after binding. Once `state.closed` is set (`connectProvider`'s
 * `disconnect`, or a refused rebind that could not stop the provider) every
 * dial is refused and stops the provider, so a `provider.connect()` after
 * teardown sends nothing, with or without the token; a close while the token
 * resolves refuses that dial too (`planBoundDial`). Tests:
 * `test/provider-auth.test.ts` "stops the provider on a dial the socket
 * constructor rejects", "stops injecting after unbind on a provider frozen
 * after binding" and "closes the earlier binding when a refused rebind cannot
 * stop the provider"; `test/provider-reconnect.test.ts` N21.
 */
function authSocket(
	slot: BindingSlot,
	Base: SocketConstructor,
	auth: AuthBinding | string | (() => string | null | undefined),
	state: BindingState,
): SocketConstructor {
	const AuthSocket = class extends Base {
		constructor(url: string | URL, protocols?: string | string[]) {
			const active = (): boolean => state.active && isActive(slot, AuthSocket);
			const plan = planBoundDial(state, active, auth, String(url), protocols);
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
	Object.defineProperty(AuthSocket, BINDING_STATE, { value: state });
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
 * function, a bound function) or is read-only, a sealed or frozen provider, a
 * `_WS` or slot write that throws (even after storing the value, see
 * `installBinding`), and a binding with `param: null` and no `protocol`, bind
 * nothing; the
 * provider is stopped (`stopProvider`) and a `console.error` names why, so it
 * dials no further without the token until the caller calls `connect()`
 * again. When the provider cannot be stopped either (a setter that ignores
 * the write, a provider frozen while dialing), the binding installed as `_WS`,
 * an earlier one, is closed (`closeInstalledBinding`), so its reconnects are
 * refused instead of sending its credentials. `connectProvider` instead
 * destroys its provider and throws (`bindOrDestroy`).
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
	if (typeof bound !== 'string') return bound.unbind;
	const left = stopProvider(provider);
	let outcome = left === undefined ? 'provider stopped' : `provider not stopped: ${left}`;
	if (left !== undefined && closeInstalledBinding(provider)) outcome += '; earlier binding closed';
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
): BoundAuth | string {
	try {
		return bindAuth(provider, auth);
	} catch (error) {
		return `reading the auth binding or the provider threw (${errorLabel(error)})`;
	}
}

/**
 * Binds `auth` as `bindProviderAuth` documents and returns its unbind and
 * close (`BoundAuth`), or returns why nothing was bound: the binding has no
 * transport, `_WS` is missing, cannot be subclassed or is read-only, or the
 * provider takes no binding slot. The unbind clears the binding's
 * `state.active` first, then writes the slot and `_WS` back with
 * `Reflect.set`, which on a provider frozen since returns `false` instead of
 * throwing. The unbind never throws: a getter, setter or proxy trap that
 * throws while it writes back is logged with `console.error`, and the binding
 * adds no token either way, so a caller's teardown after it still runs. The
 * close only sets `state.closed`, writing nothing to the provider, so it holds
 * on a provider frozen since. Tests: `test/provider-auth.test.ts` "unbind does
 * not throw when writing the provider back throws";
 * `test/provider-reconnect.test.ts` N21.
 */
function bindAuth(
	provider: AuthBindableProvider,
	auth: AuthBinding | string | (() => string | null | undefined),
): BoundAuth | string {
	const binding = toAuthBinding(auth);
	if (binding.param === null && binding.protocol === undefined) {
		return 'auth binding has no transport (param is null and protocol is unset)';
	}
	const current: unknown = provider._WS;
	if (typeof current !== 'function') return 'provider has no _WS socket constructor';
	const slot = provider as AuthBindableProvider & BindingSlot;
	const Base = innerSocket(slot, current as SocketConstructor);
	const state: BindingState = { active: true };
	let AuthSocket: SocketConstructor;
	try {
		AuthSocket = authSocket(slot, Base, auth, state);
	} catch (error) {
		return `provider _WS cannot be subclassed (${errorLabel(error)})`;
	}
	const refused = installBinding(slot, AuthSocket, current);
	if (refused !== undefined) {
		// A setter may have kept this binding somewhere; it then refuses every dial.
		state.closed = 'auth binding closed by a refused rebind';
		return refused;
	}
	const unbind = (): void => {
		state.active = false;
		try {
			if (isActive(slot, AuthSocket)) Reflect.set(slot, ACTIVE_BINDING, undefined);
			if (Reflect.get(slot, '_WS') === AuthSocket) Reflect.set(slot, '_WS', Base);
		} catch (error) {
			console.error(`[sentio] collab: unbind threw (${errorLabel(error)}); no token is added`);
		}
	};
	const close = (): void => {
		state.closed = 'provider disconnected by connectProvider';
	};
	return { unbind, close };
}

/**
 * Makes `AuthSocket` the active binding and the provider's `_WS`, reading each
 * write back, or returns why it could not. A sealed or frozen provider takes no
 * new slot, so `isActive` would never match and every dial would pass through
 * without the token; a read-only `_WS` keeps its constructor. A write that
 * throws is refused too, even when its setter or proxy trap stored the value
 * first. On any refusal both writes are rolled back (`rollBack`), so neither
 * an inactive `AuthSocket` left as `_WS` nor an earlier binding left out of
 * the slot dials without the token; `bindAuth` also closes `AuthSocket`, so a
 * copy a setter kept refuses every dial. On a first binding, a provider that
 * already dialed is stopped (`stopUnboundDial`). Tests:
 * `test/provider-auth.test.ts` "binds nothing on a sealed provider", "binds
 * nothing and keeps the earlier binding when _WS is read-only", "closes the
 * earlier binding when rolling a rebind back throws" and "keeps the earlier
 * binding when a write stores the rebind and throws".
 */
function installBinding(
	slot: AuthBindableProvider & BindingSlot,
	AuthSocket: SocketConstructor,
	current: unknown,
): string | undefined {
	const previous: unknown = Reflect.get(slot, ACTIVE_BINDING);
	const refused = claimSlot(slot, AuthSocket) ?? writeSocket(slot, AuthSocket);
	if (refused !== undefined) return rollBack(slot, previous, current, refused);
	if (previous === undefined) stopUnboundDial(slot);
	return undefined;
}

/** Writes `AuthSocket` to the active-binding slot and reads it back, or returns why it did not hold. */
function claimSlot(slot: BindingSlot, AuthSocket: SocketConstructor): string | undefined {
	try {
		Reflect.set(slot, ACTIVE_BINDING, AuthSocket);
		if (isActive(slot, AuthSocket)) return undefined;
		return 'provider takes no binding slot (sealed or frozen)';
	} catch (error) {
		return `writing the binding slot threw (${errorLabel(error)})`;
	}
}

/**
 * Rolls a refused install back: `_WS` first, to `current`, then the slot, to
 * `previous` (`rollBackSlot`), and returns `refused` with any part that did
 * not hold. When `_WS` cannot be put back it still holds the new binding,
 * which `bindAuth` closes, so every dial is refused; the slot is left naming
 * it, so a later rebind unwraps it (`innerSocket`) instead of wrapping a
 * closed binding. Tests: `test/provider-auth.test.ts` "keeps the earlier
 * binding when a write stores the rebind and throws" and "refuses every dial
 * when _WS keeps a refused rebind".
 */
function rollBack(slot: BindingSlot, previous: unknown, current: unknown, refused: string): string {
	const left = putBack(slot, '_WS', current);
	if (left === undefined) return rollBackSlot(slot, previous, refused);
	return `${refused}; putting provider _WS back ${left}, the new binding refuses every dial`;
}

/**
 * Writes `previous` back to the active-binding slot after a refused install
 * and returns `refused`. A rollback that does not hold leaves the earlier
 * binding, installed as `_WS`, out of the slot, so its dials would pass
 * through without the token after the caller's `connect()`; it is closed
 * instead (`closeInstalledBinding`), so they are refused, and the reason says
 * so. Tests: `test/provider-auth.test.ts` "closes the earlier binding when
 * rolling a rebind back throws" and "closes the earlier binding when a rebind
 * rollback does not hold".
 */
function rollBackSlot(slot: BindingSlot, previous: unknown, refused: string): string {
	const failure = putBack(slot, ACTIVE_BINDING, previous);
	if (failure === undefined) return refused;
	const closed = closeInstalledBinding(slot) ? 'earlier binding closed' : 'no binding to close';
	return `${refused}; rolling the binding slot back ${failure}, ${closed}`;
}

/**
 * Puts `value` back at `key` unless it is there already, or returns how that
 * failed. The read afterwards decides, so a setter or proxy trap that stores
 * the value and then throws counts as put back.
 */
function putBack(target: object, key: PropertyKey, value: unknown): string | undefined {
	let thrown: string | undefined;
	try {
		if (Reflect.get(target, key) === value) return undefined;
		Reflect.set(target, key, value);
	} catch (error) {
		thrown = `threw (${errorLabel(error)})`;
	}
	try {
		if (Reflect.get(target, key) === value) return undefined;
	} catch (error) {
		return `threw (${errorLabel(error)})`;
	}
	return thrown ?? 'did not hold';
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
 * later `provider.connect()` dials without the token. Returns the binding's
 * close, which `connectProvider`'s `disconnect` calls so no dial follows the
 * teardown. Tests: `test/provider-auth.test.ts` "throws instead of connecting
 * without auth"; `test/provider-reconnect.test.ts` N21.
 */
function bindOrDestroy(
	provider: WebsocketProvider,
	auth: AuthBinding | string | (() => string | null | undefined),
): () => void {
	const bound = tryBind(provider, auth);
	if (typeof bound !== 'string') return bound.close;
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
 * Whether a caller callback's throw reaches the code that started the event
 * (`surfacing`, set only while `startOrTearDown` runs the first dial), and
 * whether the callbacks are detached (`detached`, set by `disconnect`).
 */
interface CallbackGuard {
	surfacing: boolean;
	detached: boolean;
}

/**
 * Runs a caller callback with its throws kept out of y-websocket. y-websocket
 * calls status and sync listeners inside its close handler and inside
 * `connect()`, ahead of scheduling or building the next socket
 * (`closeWebsocketConnection` and `setupWS` in y-websocket 3.1.0
 * `src/y-websocket.js`), so a throw that escaped there would stop every later
 * reconnect. A throw is logged by its label alone (`errorLabel`) and the
 * provider carries on; only while `guard.surfacing` is set does it propagate,
 * to `startOrTearDown`. Once `guard.detached` is set the callback is not
 * called. Tests: `test/provider-reconnect.test.ts` N13, N14, N15, N24.
 */
function runGuarded(guard: CallbackGuard, name: string, call: () => void): void {
	if (guard.detached) return;
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
 * `disconnect()`. Both callbacks run through `runGuarded`. The detach sets
 * `guard.detached` before it removes anything, and removes each listener even
 * when removing the other throws, so a listener `off` fails to remove calls
 * no caller callback after `disconnect`. Tests: `test/provider-reconnect.test.ts`
 * N24.
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
		guard.detached = true;
		try {
			if (handleStatus) provider.off('status', handleStatus);
		} finally {
			if (handleSync) provider.off('sync', handleSync);
		}
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
 * every dial would fail on surfaces to the caller. A throw while tearing down
 * is named in that error's detail (`tearDown`). Tests:
 * `test/provider-reconnect.test.ts` N8, N13, N18, N20, N22.
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
		const torn = tearDown(teardown);
		throw new ProblemError({
			type: COLLAB_START_FAILED_TYPE,
			title: 'Collab provider start failed',
			detail: `the first dial threw (${errorLabel(error)}); ${torn}`,
			cause: error,
		});
	} finally {
		guard.surfacing = false;
	}
	const { ws } = provider;
	if (!(ws instanceof RefusedDial) || !ws.halted) return;
	const torn = tearDown(teardown);
	throw new ProblemError({
		type: COLLAB_START_FAILED_TYPE,
		title: 'Collab provider start failed',
		detail: `the first dial was refused (${ws.reason}); ${torn}`,
	});
}

/**
 * Runs `teardown` and says how it went, so a throw while tearing down after a
 * failed start lands in the `ProblemError` detail, by its label, instead of
 * replacing that error. Tests: `test/provider-reconnect.test.ts` N22.
 */
function tearDown(teardown: () => void): string {
	try {
		teardown();
		return 'the provider was torn down';
	} catch (error) {
		return `tearing the provider down threw (${errorLabel(error)})`;
	}
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

	const closeAuth = auth === undefined ? undefined : bindOrDestroy(provider, auth);

	const guard: CallbackGuard = { surfacing: false, detached: false };
	const unbindEvents = bindProviderEvents(provider, guard, onStatusChange, onSync);

	// The binding is closed first, so any later dial is refused, and the provider
	// is destroyed even when detaching the events or `provider.disconnect()`
	// throws (a socket `close()` that throws, a listener that throws).
	const disconnect = (): void => {
		try {
			if (closeAuth) closeAuth();
			unbindEvents();
		} finally {
			try {
				provider.disconnect();
			} finally {
				provider.destroy();
			}
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
