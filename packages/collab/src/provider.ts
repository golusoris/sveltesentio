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

/**
 * The auth entries a binding added to the provider: the param keys it set and
 * the subprotocols it appended. A rebind removes exactly these, so caller
 * entries survive, including a caller subprotocol equal to an auth one.
 */
interface OwnedAuth {
	readonly params: readonly string[];
	readonly protocols: readonly string[];
}

const NOTHING_OWNED: OwnedAuth = { params: [], protocols: [] };

/** Entries of `next` absent from `present`, each listed once. */
function missingEntries(present: readonly string[], next: readonly string[]): string[] {
	return next.filter((entry, index) => !present.includes(entry) && next.indexOf(entry) === index);
}

/**
 * Swaps the binding's previous auth entries for `next` and returns what it now
 * owns. `params` is mutated in place, so a reference a caller holds stays the
 * object y-websocket reads; `protocols` is rebuilt as a new array, so an array
 * the caller handed to y-websocket (possibly frozen) is never mutated.
 */
function swapOwnedAuth(
	provider: AuthBindableProvider,
	owned: OwnedAuth,
	next: ResolvedAuth,
): OwnedAuth {
	for (const key of owned.params) Reflect.deleteProperty(provider.params, key);
	Object.assign(provider.params, next.params);
	const kept = [...provider.protocols];
	for (const entry of owned.protocols) {
		const index = kept.lastIndexOf(entry);
		if (index >= 0) kept.splice(index, 1);
	}
	const added = missingEntries(kept, next.protocols);
	provider.protocols = [...kept, ...added];
	return { params: Object.keys(next.params), protocols: added };
}

/** Re-resolves `auth` on every `connection-close`, starting from `owned`. */
function bindOwnedAuth(
	provider: AuthBindableProvider,
	auth: AuthBinding | string | (() => string | null | undefined),
	owned: OwnedAuth,
): () => void {
	let current = owned;
	const rebind = (): void => {
		current = swapOwnedAuth(provider, current, resolveAuthParams(auth));
	};
	provider.on('connection-close', rebind);
	return () => provider.off('connection-close', rebind);
}

/**
 * Re-resolves `auth` into the live provider's `params` and `protocols` so a
 * rotated or revoked token is picked up on the next reconnect (`y-websocket`
 * re-reads both fields each time it dials).
 *
 * Applies the current token once at bind time, then on every `connection-close`
 * removes only the entries this binding added and adds the newly resolved ones.
 * Caller-supplied params and subprotocols survive, including a caller
 * subprotocol equal to an auth one, and no subprotocol is sent twice. When an
 * auth param key equals a caller param key, auth wins while a token is set;
 * removing the token also removes that key. `params` keeps its identity, so a
 * caller holding `provider.params` keeps writing to the object y-websocket
 * reads. Returns an unbind function. Exported for callers that construct the
 * provider themselves.
 */
export function bindProviderAuth(
	provider: AuthBindableProvider,
	auth: AuthBinding | string | (() => string | null | undefined),
): () => void {
	const owned = swapOwnedAuth(provider, NOTHING_OWNED, resolveAuthParams(auth));
	return bindOwnedAuth(provider, auth, owned);
}

/**
 * Merges caller and construction-time auth entries for the `WebsocketProvider`
 * constructor and records which entries the binding owns. An auth subprotocol
 * equal to a caller one is not appended again.
 */
function mergeInitialAuth(options: ConnectProviderOptions): {
	params: Record<string, string>;
	protocols: string[];
	owned: OwnedAuth;
} {
	const resolved =
		options.auth !== undefined ? resolveAuthParams(options.auth) : { params: {}, protocols: [] };
	const callerProtocols = [...(options.protocols ?? [])];
	const authProtocols = missingEntries(callerProtocols, resolved.protocols);
	return {
		params: { ...options.params, ...resolved.params },
		protocols: [...callerProtocols, ...authProtocols],
		owned: { params: Object.keys(resolved.params), protocols: authProtocols },
	};
}

/**
 * Collects the optional `WebsocketProvider` settings into its options bag.
 *
 * Every field is assigned only when the caller supplied it: y-websocket derives its
 * own defaults from an absent key, and under `exactOptionalPropertyTypes` a key set
 * to `undefined` is not the same as one that was never set. `connect` is held back
 * (`false`) so `connectProvider` can attach auth and status listeners before the
 * first dial runs.
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

export function connectProvider(options: ConnectProviderOptions): ConnectedProvider {
	const { url, room, doc, auth, onStatusChange, onSync } = options;

	const initial = mergeInitialAuth(options);
	const provider = new WebsocketProvider(
		url,
		room,
		doc,
		buildProviderOptions(options, initial.params, initial.protocols),
	);

	const unbindAuth = auth !== undefined ? bindOwnedAuth(provider, auth, initial.owned) : undefined;

	const unbindEvents = bindProviderEvents(provider, onStatusChange, onSync);

	if (options.connect !== false) provider.connect();

	const disconnect = (): void => {
		if (unbindAuth) unbindAuth();
		unbindEvents();
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
