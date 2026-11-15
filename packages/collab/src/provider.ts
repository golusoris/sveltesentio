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
	 * Resolves the current auth token. `connectProvider` calls it at construction
	 * and again right before every later dial; `bindProviderAuth` calls it at bind
	 * time and on every `connection-close`. Returning `null` / `undefined` / `''`
	 * attaches nothing (anonymous connect).
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
	/**
	 * Receives an error `token` throws during a refresh; the dial then goes out
	 * without credentials, as for a revoked token. Without it the error goes to
	 * `console.error`. A throw during construction or bind still reaches the
	 * caller. Tests: `test/provider-reconnect.test.ts` N7,
	 * `test/provider-auth.test.ts` "clears owned entries when the resolver throws".
	 */
	readonly onError?: (error: unknown) => void;
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
 * The slice of `WebsocketProvider` the auth binding touches.
 *
 * Structural rather than `Pick<WebsocketProvider, …>`: y-websocket types `on` and
 * `off` through its observable base, and a hand-written double cannot satisfy
 * those signatures without reproducing the class. Naming the four members this
 * function actually uses lets a test pass a stand-in, which is what its own
 * fake was already trying to be.
 *
 * A real `WebsocketProvider` remains assignable, so callers are unchanged.
 */
export interface AuthBindableProvider {
	params: Record<string, string>;
	protocols: string[];
	on(event: 'connection-close', cb: () => void): void;
	off(event: 'connection-close', cb: () => void): void;
}

/** The two provider fields auth entries live in. */
interface AuthSlots {
	params: Record<string, string>;
	protocols: string[];
}

/**
 * Auth entries a binding placed: each param key with the caller value it
 * shadows, and each subprotocol it appended.
 */
interface OwnedAuth {
	readonly params: ReadonlyMap<string, string | undefined>;
	readonly protocols: readonly string[];
}

const NOTHING_OWNED: OwnedAuth = { params: new Map(), protocols: [] };
const NO_AUTH: ResolvedAuth = { params: {}, protocols: [] };

/**
 * Entries of `next` absent from `present`, each once. Browsers reject a
 * repeated subprotocol (WHATWG WebSockets, `new WebSocket()` step "occur more
 * than once"). Tests: `test/provider-reconnect.test.ts` N6.
 */
function missingEntries(present: readonly string[], next: readonly string[]): string[] {
	return next.filter((entry, index) => !present.includes(entry) && next.indexOf(entry) === index);
}

/** The value `params` holds for `key` itself, ignoring inherited keys. */
function ownValue(
	params: Readonly<Record<string, string>> | undefined,
	key: string,
): string | undefined {
	return params !== undefined && Object.hasOwn(params, key) ? params[key] : undefined;
}

/**
 * Puts back the caller values `owned` shadowed, then applies `next` in place so
 * a held `provider.params` reference stays live. Tests:
 * `test/provider-reconnect.test.ts` N3, N10, P5.
 */
function swapOwnedParams(
	params: Record<string, string>,
	owned: ReadonlyMap<string, string | undefined>,
	next: Readonly<Record<string, string>>,
): Map<string, string | undefined> {
	for (const [key, callerValue] of owned) {
		if (callerValue === undefined) Reflect.deleteProperty(params, key);
		else params[key] = callerValue;
	}
	const shadowed = new Map<string, string | undefined>();
	for (const [key, value] of Object.entries(next)) {
		shadowed.set(key, ownValue(params, key));
		params[key] = value;
	}
	return shadowed;
}

/**
 * Removes the owned subprotocols and appends the missing entries of `next`,
 * returning a new array so a caller's (possibly frozen) array is never mutated.
 * An owned entry was absent when it was appended, so its copy is the first one;
 * a copy the caller pushed later stays in place. Tests:
 * `test/provider-reconnect.test.ts` N4, N6; `test/provider-auth.test.ts`
 * "keeps the position of a caller copy of an owned subprotocol".
 */
function swapOwnedProtocols(
	current: readonly string[],
	owned: readonly string[],
	next: readonly string[],
): { protocols: string[]; added: string[] } {
	const kept = [...current];
	for (const entry of owned) {
		const index = kept.indexOf(entry);
		if (index >= 0) kept.splice(index, 1);
	}
	const added = missingEntries(kept, next);
	return { protocols: [...kept, ...added], added };
}

function swapOwnedAuth(slots: AuthSlots, owned: OwnedAuth, next: ResolvedAuth): OwnedAuth {
	const params = swapOwnedParams(slots.params, owned.params, next.params);
	const { protocols, added } = swapOwnedProtocols(slots.protocols, owned.protocols, next.protocols);
	slots.protocols = protocols;
	return { params, protocols: added };
}

function reportAuthError(
	auth: AuthBinding | string | (() => string | null | undefined),
	error: unknown,
): void {
	const onError = typeof auth === 'object' ? auth.onError : undefined;
	if (onError !== undefined) onError(error);
	else
		console.error(
			'[sentio] collab: auth token resolver threw; dialling without credentials',
			error,
		);
}

/**
 * Re-resolves `auth` into `slots`. A resolver throw clears the owned entries and
 * is reported instead of escaping into y-websocket's close or dial path, where
 * it would leave the stale token configured and stop the reconnect loop.
 * Tests: `test/provider-reconnect.test.ts` N7.
 */
function refreshOwnedAuth(
	slots: AuthSlots,
	owned: OwnedAuth,
	auth: AuthBinding | string | (() => string | null | undefined),
): OwnedAuth {
	let next = NO_AUTH;
	try {
		next = resolveAuthParams(auth);
	} catch (error) {
		reportAuthError(auth, error);
	}
	return swapOwnedAuth(slots, owned, next);
}

/**
 * Re-resolves `auth` into the live provider's `params` and `protocols` so a
 * rotated or revoked token is picked up on the next reconnect (`y-websocket`
 * re-reads both fields each time it dials). Applies the token at bind time,
 * then refreshes on every `connection-close`.
 *
 * Caller entries survive: a caller param under the auth key comes back when the
 * token is revoked, and a caller subprotocol equal to an auth one stays and is
 * sent once. Returns an unbind function. For callers that construct the
 * provider themselves; `connectProvider` refreshes at each dial instead. Tests:
 * the `bindProviderAuth` block in `test/provider-auth.test.ts`.
 */
export function bindProviderAuth(
	provider: AuthBindableProvider,
	auth: AuthBinding | string | (() => string | null | undefined),
): () => void {
	let owned = swapOwnedAuth(provider, NOTHING_OWNED, resolveAuthParams(auth));
	const rebind = (): void => {
		owned = refreshOwnedAuth(provider, owned, auth);
	};
	provider.on('connection-close', rebind);
	return () => provider.off('connection-close', rebind);
}

/**
 * Caller and construction-time auth entries for the `WebsocketProvider`
 * constructor, so `provider.params` shows the token before the first dial.
 * Tests: `test/provider-reconnect.test.ts` P6; `test/provider-auth.test.ts`
 * "merges auth token with caller-supplied params".
 */
function mergeInitialAuth(options: ConnectProviderOptions): { slots: AuthSlots; owned: OwnedAuth } {
	const slots: AuthSlots = {
		params: { ...options.params },
		protocols: [...(options.protocols ?? [])],
	};
	const resolved = options.auth !== undefined ? resolveAuthParams(options.auth) : NO_AUTH;
	return { slots, owned: swapOwnedAuth(slots, NOTHING_OWNED, resolved) };
}

type SocketConstructor = WebsocketProvider['_WS'];

interface DialTarget {
	readonly url: string;
	readonly protocols: string[];
}

/**
 * Subclass of `Base` that asks `beforeDial` for the URL and subprotocols as the
 * socket is built, the last point a refreshed token can still reach the dial
 * (`setupWS` in y-websocket 3.1.0 `src/y-websocket.js` builds the socket with
 * `new provider._WS(provider.url, provider.protocols)`). Tests:
 * `test/provider-auth.test.ts` "resolves a rotating token for every dial, not
 * only at construction"; `test/provider-reconnect.test.ts` P6, N9.
 */
function dialTimeSocket(Base: SocketConstructor, beforeDial: () => DialTarget): SocketConstructor {
	return class extends Base {
		constructor(_url: string | URL, _protocols?: string | string[]) {
			const target = beforeDial();
			super(target.url, target.protocols);
		}
	};
}

/**
 * Re-resolves `auth` right before each dial: y-websocket reads `_WS` (typed as a
 * public field in its 3.x declarations) every time `setupWS` opens a socket.
 * A held-back first dial or a dial after a long backoff therefore sends the
 * token current at that moment. The construction-time token serves the first
 * dial only when `connectProvider` starts it itself. Tests:
 * `test/provider-reconnect.test.ts` P4, P6, N9.
 */
function refreshAtEachDial(
	provider: WebsocketProvider,
	auth: AuthBinding | string | (() => string | null | undefined),
	owned: OwnedAuth,
	firstDialFresh: boolean,
): void {
	let current = owned;
	let fresh = firstDialFresh;
	provider._WS = dialTimeSocket(provider._WS, () => {
		if (fresh) fresh = false;
		else current = refreshOwnedAuth(provider, current, auth);
		return { url: provider.url, protocols: provider.protocols };
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
	mergedParams: Record<string, string>,
	mergedProtocols: string[],
): ConstructorParameters<typeof WebsocketProvider>[3] {
	const { awareness, WebSocketPolyfill, resyncInterval, maxBackoffTime, disableBc } = options;
	const providerOptions: ConstructorParameters<typeof WebsocketProvider>[3] = { connect: false };
	if (awareness !== undefined) providerOptions.awareness = awareness;
	if (Object.keys(mergedParams).length > 0) providerOptions.params = mergedParams;
	if (mergedProtocols.length > 0) providerOptions.protocols = mergedProtocols;
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
	const { url, room, doc, auth, onStatusChange, onSync } = options;
	const dialsNow = options.connect !== false;

	const initial = mergeInitialAuth(options);
	const provider = new WebsocketProvider(
		url,
		room,
		doc,
		buildProviderOptions(options, initial.slots.params, initial.slots.protocols),
	);
	if (auth !== undefined) refreshAtEachDial(provider, auth, initial.owned, dialsNow);

	const unbindEvents = bindProviderEvents(provider, onStatusChange, onSync);

	const disconnect = (): void => {
		unbindEvents();
		provider.disconnect();
		provider.destroy();
	};

	if (dialsNow) startOrTearDown(provider, disconnect);

	return { provider, disconnect };
}

function normaliseStatus(status: string): ProviderStatus {
	if (status === 'connected') return 'connected';
	if (status === 'connecting') return 'connecting';
	return 'disconnected';
}
