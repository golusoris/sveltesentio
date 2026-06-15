import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
	AwarenessChange,
	AwarenessEvent,
	AwarenessLike,
	PresenceState,
} from '../src/awareness.js';

/**
 * Non-reactive `$state` / `$effect` shim — see createYjsStore.test.ts for the
 * rationale. The presence store's getters close over `let others/local =
 * $state(...)` bindings, so reassignment inside the awareness `'change'`
 * callback is what the getters surface (ADR-0039). Local mutations must route
 * through the awareness, never the proxy.
 */
const teardowns: Array<() => void> = [];
const g = globalThis as unknown as {
	$state?: unknown;
	$effect?: unknown;
};

beforeEach(() => {
	g.$state = <T>(initial: T): T => initial;
	const effect = (fn: () => void | (() => void)): void => {
		const cleanup = fn();
		if (typeof cleanup === 'function') teardowns.push(cleanup);
	};
	g.$effect = effect;
});

afterEach(() => {
	teardowns.length = 0;
	delete g.$state;
	delete g.$effect;
});

type Listener = (change: AwarenessChange, origin: unknown) => void;

/** Minimal in-memory awareness fake matching the structural interface. */
class FakeAwareness<S extends PresenceState = PresenceState>
	implements AwarenessLike<S>
{
	readonly clientID: number;
	private readonly states = new Map<number, S>();
	private readonly listeners = new Map<AwarenessEvent, Set<Listener>>();

	constructor(clientID = 1) {
		this.clientID = clientID;
	}

	getStates(): Map<number, S> {
		return this.states;
	}

	getLocalState(): S | null {
		return this.states.get(this.clientID) ?? null;
	}

	setLocalState(state: S | null): void {
		if (state === null) this.states.delete(this.clientID);
		else this.states.set(this.clientID, state);
	}

	on(event: AwarenessEvent, listener: Listener): void {
		let set = this.listeners.get(event);
		if (!set) {
			set = new Set();
			this.listeners.set(event, set);
		}
		set.add(listener);
	}

	off(event: AwarenessEvent, listener: Listener): void {
		this.listeners.get(event)?.delete(listener);
	}

	/** Test helper: set a remote client's state directly. */
	setRemote(clientId: number, state: S): void {
		this.states.set(clientId, state);
	}

	/** Test helper: remove a remote client's state directly. */
	removeRemote(clientId: number): void {
		this.states.delete(clientId);
	}

	/** Test helper: emit an awareness event to registered listeners. */
	emit(
		event: AwarenessEvent,
		change: AwarenessChange = { added: [], updated: [], removed: [] },
		origin: unknown = 'remote',
	): void {
		for (const listener of this.listeners.get(event) ?? []) listener(change, origin);
	}

	listenerCount(event: AwarenessEvent): number {
		return this.listeners.get(event)?.size ?? 0;
	}
}

type User = { name: string; color?: string };

describe('createPresenceStore', () => {
	it('snapshots existing remote participants at construction', async () => {
		const { createPresenceStore } = await import('../src/presence-store.svelte.js');
		const aw = new FakeAwareness<User>(1);
		aw.setRemote(2, { name: 'ada' });
		aw.setRemote(3, { name: 'grace' });

		const store = createPresenceStore(aw);
		expect(store.others).toEqual([
			{ clientId: 2, state: { name: 'ada' } },
			{ clientId: 3, state: { name: 'grace' } },
		]);
		expect(store.count).toBe(2);
		expect(store.clientId).toBe(1);
	});

	it('excludes the local client from others by default', async () => {
		const { createPresenceStore } = await import('../src/presence-store.svelte.js');
		const aw = new FakeAwareness<User>(1);
		aw.setLocalState({ name: 'me' });
		aw.setRemote(2, { name: 'ada' });

		const store = createPresenceStore(aw);
		expect(store.others).toEqual([{ clientId: 2, state: { name: 'ada' } }]);
		expect(store.count).toBe(1);
		expect(store.local).toEqual({ name: 'me' });
	});

	it('includes the local client when excludeLocal is false', async () => {
		const { createPresenceStore } = await import('../src/presence-store.svelte.js');
		const aw = new FakeAwareness<User>(1);
		aw.setLocalState({ name: 'me' });
		aw.setRemote(2, { name: 'ada' });

		const store = createPresenceStore(aw, { excludeLocal: false });
		expect(store.others).toEqual([
			{ clientId: 1, state: { name: 'me' } },
			{ clientId: 2, state: { name: 'ada' } },
		]);
		expect(store.count).toBe(2);
	});

	it('re-snapshots others on a remote add change event', async () => {
		const { createPresenceStore } = await import('../src/presence-store.svelte.js');
		const aw = new FakeAwareness<User>(1);
		const store = createPresenceStore(aw);
		expect(store.others).toEqual([]);

		aw.setRemote(2, { name: 'ada' });
		aw.emit('change', { added: [2], updated: [], removed: [] });

		expect(store.others).toEqual([{ clientId: 2, state: { name: 'ada' } }]);
		expect(store.count).toBe(1);
	});

	it('re-snapshots others on a remote update change event', async () => {
		const { createPresenceStore } = await import('../src/presence-store.svelte.js');
		const aw = new FakeAwareness<User>(1);
		aw.setRemote(2, { name: 'ada' });
		const store = createPresenceStore(aw);

		aw.setRemote(2, { name: 'ada', color: 'red' });
		aw.emit('change', { added: [], updated: [2], removed: [] });

		expect(store.others).toEqual([
			{ clientId: 2, state: { name: 'ada', color: 'red' } },
		]);
	});

	it('re-snapshots others on a remote remove change event', async () => {
		const { createPresenceStore } = await import('../src/presence-store.svelte.js');
		const aw = new FakeAwareness<User>(1);
		aw.setRemote(2, { name: 'ada' });
		aw.setRemote(3, { name: 'grace' });
		const store = createPresenceStore(aw);
		expect(store.count).toBe(2);

		aw.removeRemote(3);
		aw.emit('change', { added: [], updated: [], removed: [3] });

		expect(store.others).toEqual([{ clientId: 2, state: { name: 'ada' } }]);
		expect(store.count).toBe(1);
	});

	it('reflects the local state changing on a change event', async () => {
		const { createPresenceStore } = await import('../src/presence-store.svelte.js');
		const aw = new FakeAwareness<User>(1);
		const store = createPresenceStore(aw);
		expect(store.local).toBeUndefined();

		aw.setLocalState({ name: 'me' });
		aw.emit('change', { added: [1], updated: [], removed: [] });
		expect(store.local).toEqual({ name: 'me' });
	});

	it('setLocal routes through the awareness, not the proxy', async () => {
		const { createPresenceStore } = await import('../src/presence-store.svelte.js');
		const aw = new FakeAwareness<User>(1);
		const store = createPresenceStore(aw);

		store.setLocal({ name: 'ada' });
		expect(aw.getLocalState()).toEqual({ name: 'ada' });

		store.setLocal(null);
		expect(aw.getLocalState()).toBeNull();
	});

	it('patchLocal merges into the awareness local state', async () => {
		const { createPresenceStore } = await import('../src/presence-store.svelte.js');
		const aw = new FakeAwareness<User>(1);
		const store = createPresenceStore(aw);

		store.setLocal({ name: 'ada' });
		store.patchLocal({ color: 'green' });
		expect(aw.getLocalState()).toEqual({ name: 'ada', color: 'green' });
	});

	it('patchLocal starts from empty when no local state exists', async () => {
		const { createPresenceStore } = await import('../src/presence-store.svelte.js');
		const aw = new FakeAwareness<User>(1);
		const store = createPresenceStore(aw);

		store.patchLocal({ name: 'grace' });
		expect(aw.getLocalState()).toEqual({ name: 'grace' });
	});

	it('$effect cleanup unsubscribes from the awareness', async () => {
		const { createPresenceStore } = await import('../src/presence-store.svelte.js');
		const aw = new FakeAwareness<User>(1);
		const store = createPresenceStore(aw);
		expect(aw.listenerCount('change')).toBe(1);

		expect(teardowns).toHaveLength(1);
		teardowns[0]!();
		expect(aw.listenerCount('change')).toBe(0);

		// After teardown no further change is observed.
		aw.setRemote(2, { name: 'late' });
		aw.emit('change', { added: [2], updated: [], removed: [] });
		expect(store.others).toEqual([]);
	});
});
