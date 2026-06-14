/**
 * Typed helpers over a `y-protocols/awareness` Awareness instance.
 *
 * The helpers are written against a structural {@link AwarenessLike} interface
 * — only the members actually used are required — so `y-protocols` stays an
 * optional peer and the logic is unit-testable with a fake awareness object.
 */

/** A single client's presence state, keyed by client id in the awareness map. */
export type PresenceState = Record<string, unknown>;

/** Payload shape emitted by the awareness `'change'` / `'update'` events. */
export interface AwarenessChange {
	readonly added: number[];
	readonly updated: number[];
	readonly removed: number[];
}

/**
 * Names of the awareness events these helpers subscribe to. `'change'` fires
 * only when a client's state actually changed; `'update'` fires on every
 * received update (including no-op heartbeats). Presence UX wants `'change'`.
 */
export type AwarenessEvent = 'change' | 'update' | 'destroy';

type AwarenessChangeListener = (change: AwarenessChange, origin: unknown) => void;

/**
 * Structural subset of `y-protocols/awareness` Awareness used by these helpers.
 * Matching only what is consumed keeps `y-protocols` an optional peer dep and
 * lets tests supply a fake.
 */
export interface AwarenessLike<S extends PresenceState = PresenceState> {
	readonly clientID: number;
	getStates(): Map<number, S>;
	getLocalState(): S | null;
	setLocalState(state: S | null): void;
	on(event: AwarenessEvent, listener: AwarenessChangeListener): void;
	off(event: AwarenessEvent, listener: AwarenessChangeListener): void;
}

/** One participant's presence entry, as surfaced to UX layers. */
export interface PresenceEntry<S extends PresenceState = PresenceState> {
	readonly clientId: number;
	readonly state: S;
}

/** Result of {@link diffPresence}: client ids partitioned by transition. */
export interface PresenceDiff<S extends PresenceState = PresenceState> {
	readonly added: PresenceEntry<S>[];
	readonly updated: PresenceEntry<S>[];
	readonly removed: number[];
}

/** Options for {@link observePresence}. */
export interface ObservePresenceOptions {
	/**
	 * Awareness event to subscribe to. Defaults to `'change'` so listeners only
	 * fire on real presence transitions, not on every heartbeat.
	 */
	readonly event?: AwarenessEvent;
}

/**
 * Replace the calling client's local presence state. Pass `null` to clear it
 * (signals the client is leaving / going idle).
 */
export function setLocalPresence<S extends PresenceState>(
	awareness: AwarenessLike<S>,
	state: S | null,
): void {
	awareness.setLocalState(state);
}

/**
 * Merge fields into the calling client's local presence state without clobbering
 * unrelated fields. A `null` current state is treated as an empty object.
 */
export function patchLocalPresence<S extends PresenceState>(
	awareness: AwarenessLike<S>,
	patch: Partial<S>,
): void {
	const current = awareness.getLocalState() ?? ({} as S);
	awareness.setLocalState({ ...current, ...patch });
}

/**
 * Snapshot all known client presence states as a `Map` of `clientId -> state`.
 * The returned map is a fresh copy; mutating it does not affect the awareness.
 */
export function snapshotPresence<S extends PresenceState>(
	awareness: AwarenessLike<S>,
): Map<number, S> {
	return new Map(awareness.getStates());
}

/**
 * Snapshot presence as an array of `{clientId, state}` entries, excluding the
 * local client when `excludeLocal` is set — the typical "who else is here" view.
 */
export function snapshotOthers<S extends PresenceState>(
	awareness: AwarenessLike<S>,
	excludeLocal = true,
): PresenceEntry<S>[] {
	const localId = awareness.clientID;
	const out: PresenceEntry<S>[] = [];
	for (const [clientId, state] of awareness.getStates()) {
		if (excludeLocal && clientId === localId) continue;
		out.push({ clientId, state });
	}
	return out;
}

/**
 * Subscribe to presence changes. The callback fires with the current change
 * payload on every emission of the chosen event (default `'change'`). Returns an
 * unsubscribe function; calling it removes the listener.
 */
export function observePresence(
	awareness: AwarenessLike,
	callback: (change: AwarenessChange, origin: unknown) => void,
	options: ObservePresenceOptions = {},
): () => void {
	const event = options.event ?? 'change';
	const listener: AwarenessChangeListener = (change, origin) => {
		callback(change, origin);
	};
	awareness.on(event, listener);
	return () => awareness.off(event, listener);
}

/**
 * Diff two presence snapshots into `{added, updated, removed}` for presence-UX.
 * `added` / `updated` carry the new entry; `removed` carries the departed client
 * ids. `updated` includes only clients whose state object reference changed —
 * Yjs replaces the state object on every change, so reference equality is a
 * correct and cheap staleness check.
 */
export function diffPresence<S extends PresenceState>(
	prev: ReadonlyMap<number, S>,
	next: ReadonlyMap<number, S>,
): PresenceDiff<S> {
	const added: PresenceEntry<S>[] = [];
	const updated: PresenceEntry<S>[] = [];
	const removed: number[] = [];

	for (const [clientId, state] of next) {
		if (!prev.has(clientId)) {
			added.push({ clientId, state });
		} else if (prev.get(clientId) !== state) {
			updated.push({ clientId, state });
		}
	}

	for (const clientId of prev.keys()) {
		if (!next.has(clientId)) removed.push(clientId);
	}

	return { added, updated, removed };
}
