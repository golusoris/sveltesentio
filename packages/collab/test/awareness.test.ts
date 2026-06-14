import { describe, it, expect } from 'vitest';
import {
	type AwarenessChange,
	type AwarenessEvent,
	type AwarenessLike,
	type PresenceState,
	setLocalPresence,
	patchLocalPresence,
	snapshotPresence,
	snapshotOthers,
	observePresence,
	diffPresence,
} from '../src/awareness.js';

type Listener = (change: AwarenessChange, origin: unknown) => void;

/**
 * Minimal in-memory fake of `y-protocols` Awareness exercising the structural
 * interface. Tracks per-client state and listeners by event name.
 */
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

	/** Test helper: emit a change event to registered listeners. */
	emit(event: AwarenessEvent, change: AwarenessChange, origin: unknown = 'local'): void {
		for (const listener of this.listeners.get(event) ?? []) listener(change, origin);
	}

	listenerCount(event: AwarenessEvent): number {
		return this.listeners.get(event)?.size ?? 0;
	}
}

describe('awareness — local presence', () => {
	it('setLocalPresence writes the local state', () => {
		const aw = new FakeAwareness<{ name: string }>(7);
		setLocalPresence(aw, { name: 'ada' });
		expect(aw.getLocalState()).toEqual({ name: 'ada' });
	});

	it('setLocalPresence(null) clears the local state', () => {
		const aw = new FakeAwareness<{ name: string }>(7);
		setLocalPresence(aw, { name: 'ada' });
		setLocalPresence(aw, null);
		expect(aw.getLocalState()).toBeNull();
	});

	it('patchLocalPresence merges fields without clobbering', () => {
		const aw = new FakeAwareness<{ name: string; color?: string }>(7);
		setLocalPresence(aw, { name: 'ada' });
		patchLocalPresence(aw, { color: 'red' });
		expect(aw.getLocalState()).toEqual({ name: 'ada', color: 'red' });
	});

	it('patchLocalPresence starts from empty when no local state exists', () => {
		const aw = new FakeAwareness<{ name: string }>(7);
		patchLocalPresence(aw, { name: 'grace' });
		expect(aw.getLocalState()).toEqual({ name: 'grace' });
	});
});

describe('awareness — snapshots', () => {
	it('snapshotPresence returns a fresh copy of all states', () => {
		const aw = new FakeAwareness<{ n: number }>(1);
		aw.setRemote(1, { n: 1 });
		aw.setRemote(2, { n: 2 });
		const snap = snapshotPresence(aw);
		expect([...snap.entries()]).toEqual([
			[1, { n: 1 }],
			[2, { n: 2 }],
		]);
		snap.delete(1);
		expect(aw.getStates().has(1)).toBe(true);
	});

	it('snapshotOthers excludes the local client by default', () => {
		const aw = new FakeAwareness<{ n: number }>(1);
		aw.setRemote(1, { n: 1 });
		aw.setRemote(2, { n: 2 });
		aw.setRemote(3, { n: 3 });
		expect(snapshotOthers(aw)).toEqual([
			{ clientId: 2, state: { n: 2 } },
			{ clientId: 3, state: { n: 3 } },
		]);
	});

	it('snapshotOthers can include the local client', () => {
		const aw = new FakeAwareness<{ n: number }>(1);
		aw.setRemote(1, { n: 1 });
		aw.setRemote(2, { n: 2 });
		expect(snapshotOthers(aw, false)).toEqual([
			{ clientId: 1, state: { n: 1 } },
			{ clientId: 2, state: { n: 2 } },
		]);
	});
});

describe('awareness — observePresence', () => {
	it('invokes the callback on the change event and unsubscribes', () => {
		const aw = new FakeAwareness(1);
		const seen: AwarenessChange[] = [];
		const unsub = observePresence(aw, (change) => seen.push(change));
		expect(aw.listenerCount('change')).toBe(1);

		aw.emit('change', { added: [2], updated: [], removed: [] });
		aw.emit('change', { added: [], updated: [2], removed: [] });
		unsub();
		expect(aw.listenerCount('change')).toBe(0);
		aw.emit('change', { added: [], updated: [], removed: [2] });

		expect(seen).toEqual([
			{ added: [2], updated: [], removed: [] },
			{ added: [], updated: [2], removed: [] },
		]);
	});

	it('forwards the origin to the callback', () => {
		const aw = new FakeAwareness(1);
		let received: unknown;
		observePresence(aw, (_change, origin) => {
			received = origin;
		});
		aw.emit('change', { added: [], updated: [], removed: [] }, 'remote');
		expect(received).toBe('remote');
	});

	it('subscribes to the update event when requested', () => {
		const aw = new FakeAwareness(1);
		const seen: AwarenessChange[] = [];
		observePresence(aw, (change) => seen.push(change), { event: 'update' });
		expect(aw.listenerCount('update')).toBe(1);
		expect(aw.listenerCount('change')).toBe(0);
		aw.emit('update', { added: [9], updated: [], removed: [] });
		expect(seen).toHaveLength(1);
	});
});

describe('awareness — diffPresence', () => {
	it('classifies added clients', () => {
		const prev = new Map<number, { n: number }>();
		const next = new Map([[2, { n: 2 }]]);
		expect(diffPresence(prev, next)).toEqual({
			added: [{ clientId: 2, state: { n: 2 } }],
			updated: [],
			removed: [],
		});
	});

	it('classifies removed clients', () => {
		const prev = new Map([[2, { n: 2 }]]);
		const next = new Map<number, { n: number }>();
		expect(diffPresence(prev, next)).toEqual({
			added: [],
			updated: [],
			removed: [2],
		});
	});

	it('classifies updated clients by reference change', () => {
		const shared = { n: 1 };
		const prev = new Map([
			[1, shared],
			[2, { n: 2 }],
		]);
		const changed = { n: 2 };
		const next = new Map([
			[1, shared],
			[2, changed],
		]);
		expect(diffPresence(prev, next)).toEqual({
			added: [],
			updated: [{ clientId: 2, state: { n: 2 } }],
			removed: [],
		});
	});

	it('treats an identical reference as unchanged', () => {
		const a = { n: 1 };
		const prev = new Map([[1, a]]);
		const next = new Map([[1, a]]);
		const diff = diffPresence(prev, next);
		expect(diff.added).toEqual([]);
		expect(diff.updated).toEqual([]);
		expect(diff.removed).toEqual([]);
	});

	it('handles simultaneous add, update, and remove', () => {
		const keep = { v: 'b' };
		const prev = new Map([
			[1, { v: 'a' }],
			[2, keep],
			[3, { v: 'gone' }],
		]);
		const next = new Map([
			[1, { v: 'a2' }],
			[2, keep],
			[4, { v: 'new' }],
		]);
		const diff = diffPresence(prev, next);
		expect(diff.added).toEqual([{ clientId: 4, state: { v: 'new' } }]);
		expect(diff.updated).toEqual([{ clientId: 1, state: { v: 'a2' } }]);
		expect(diff.removed).toEqual([3]);
	});
});
