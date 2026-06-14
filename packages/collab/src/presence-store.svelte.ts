import {
	type AwarenessLike,
	type PresenceEntry,
	type PresenceState,
	observePresence,
	snapshotOthers,
} from './awareness.js';

export interface PresenceStoreOptions {
	/**
	 * Exclude the local client from `others` / `all` (default `true`). The local
	 * client's own state is always available via `local`.
	 */
	readonly excludeLocal?: boolean;
}

export interface PresenceStore<S extends PresenceState = PresenceState> {
	/** Remote participants, reactive. Excludes the local client by default. */
	readonly others: readonly PresenceEntry<S>[];
	/** Number of remote participants. */
	readonly count: number;
	/** The local client's current presence state, or `undefined` if unset. */
	readonly local: S | undefined;
	/** The local client id. */
	readonly clientId: number;
	/** Replace the local presence state (pass `null` to clear). */
	setLocal(state: S | null): void;
	/** Merge fields into the local presence state. */
	patchLocal(patch: Partial<S>): void;
}

/**
 * Runes store wrapping {@link observePresence} into reactive `$state`. Mirrors
 * the `createYjsStore` lifecycle: subscribes inside `$effect` on mount,
 * unsubscribes on teardown. SSR-safe — `$effect` does not run on the server.
 *
 * `others` re-snapshots on every awareness `'change'` event. Local mutations
 * route through the awareness (never the proxy), matching the package invariant.
 */
export function createPresenceStore<S extends PresenceState = PresenceState>(
	awareness: AwarenessLike<S>,
	options: PresenceStoreOptions = {},
): PresenceStore<S> {
	const excludeLocal = options.excludeLocal ?? true;

	let others = $state<PresenceEntry<S>[]>(snapshotOthers(awareness, excludeLocal));
	let local = $state<S | undefined>(awareness.getLocalState() ?? undefined);

	$effect(() => {
		const refresh = (): void => {
			others = snapshotOthers(awareness, excludeLocal);
			local = awareness.getLocalState() ?? undefined;
		};
		refresh();
		return observePresence(awareness, refresh);
	});

	return {
		get others(): readonly PresenceEntry<S>[] {
			return others;
		},
		get count(): number {
			return others.length;
		},
		get local(): S | undefined {
			return local;
		},
		get clientId(): number {
			return awareness.clientID;
		},
		setLocal(state: S | null): void {
			awareness.setLocalState(state);
		},
		patchLocal(patch: Partial<S>): void {
			const current = awareness.getLocalState() ?? ({} as S);
			awareness.setLocalState({ ...current, ...patch });
		},
	};
}
