/**
 * Reconnection suite for `connectProvider` / `bindProviderAuth` (gap audit C14-6).
 *
 * Guards provider recovery across real WebSocket disconnects: status transitions,
 * `onSync` resets, offline CRDT edit convergence, a token resolved at every dial
 * (rotation, revocation, a held-back first dial), a refused dial when the
 * resolver throws, caller params and subprotocols kept and read at every dial,
 * teardown when the first dial throws, terminal 44xx closes, backoff capping,
 * and closed sockets leaving the relay.
 * Uses the deterministic in-memory `y-protocols/sync` relay (`./mem-relay.js`)
 * and Vitest fake timers — no network sockets or wall-clock sleeps.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
	type AuthBinding,
	type ConnectedProvider,
	type ProviderStatus,
	connectProvider,
} from '../src/provider.js';
import { type MemDial, type MemRelay, type MemSocket, createMemRelay } from './mem-relay.js';

const SERVER_URL = 'ws://localhost:1234';
const FAST_BACKOFF_MS = 50;
const MICROTASK_FLUSH_STEPS = 8;

interface PeerOptions {
	readonly doc?: Y.Doc;
	readonly params?: Readonly<Record<string, string>>;
	readonly protocols?: readonly string[];
	readonly auth?: AuthBinding | string | (() => string | null | undefined);
	readonly maxBackoffTime?: number;
	readonly connect?: boolean;
}

interface PeerHandle {
	readonly doc: Y.Doc;
	readonly provider: ConnectedProvider['provider'];
	readonly disconnect: () => void;
	readonly statuses: ProviderStatus[];
	readonly syncs: boolean[];
}

const teardowns: Array<() => void> = [];

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	for (const cleanup of teardowns.splice(0)) {
		cleanup();
	}
	vi.useRealTimers();
});

async function settle(ms = 0): Promise<void> {
	await vi.advanceTimersByTimeAsync(ms);
	for (let i = 0; i < MICROTASK_FLUSH_STEPS; i += 1) {
		await Promise.resolve();
	}
}

function connectPeer(relay: MemRelay, room: string, opts: PeerOptions = {}): PeerHandle {
	const { doc: suppliedDoc, maxBackoffTime = FAST_BACKOFF_MS, ...rest } = opts;
	const doc = suppliedDoc ?? new Y.Doc();
	const statuses: ProviderStatus[] = [];
	const syncs: boolean[] = [];
	const { provider, disconnect: rawDisconnect } = connectProvider({
		url: SERVER_URL,
		room,
		doc,
		disableBc: true,
		maxBackoffTime,
		WebSocketPolyfill: relay.Socket as unknown as typeof WebSocket,
		onStatusChange: (status) => {
			statuses.push(status);
		},
		onSync: (synced) => {
			syncs.push(synced);
		},
		...rest,
	});
	let closed = false;
	const disconnect = (): void => {
		if (closed) return;
		closed = true;
		rawDisconnect();
	};
	teardowns.push(() => {
		disconnect();
		doc.destroy();
	});
	return { doc, provider, disconnect, statuses, syncs };
}

function requireDial(relay: MemRelay, index: number): MemDial {
	const dial = relay.dials[index];
	if (dial === undefined) {
		throw new Error(`Expected dial ${index}, saw ${relay.dials.length}`);
	}
	return dial;
}

function activeSocket(peer: PeerHandle): MemSocket {
	const ws = peer.provider.ws as unknown as MemSocket | null;
	if (ws === null) {
		throw new Error('Expected open socket on provider');
	}
	return ws;
}

function snapshotMapViaUpdate(doc: Y.Doc, mapName: string): Record<string, unknown> {
	const clone = new Y.Doc();
	Y.applyUpdate(clone, Y.encodeStateAsUpdate(doc));
	const snapshot = clone.getMap(mapName).toJSON();
	clone.destroy();
	return snapshot;
}

describe('connectProvider reconnection — positive', () => {
	it('P1: connects, reports status + sync, and converges bidirectional edits', async () => {
		const relay = createMemRelay();
		const peerA = connectPeer(relay, 'room-p1');
		const peerB = connectPeer(relay, 'room-p1');

		await settle();

		expect(peerA.statuses).toEqual(['connecting', 'connected']);
		expect(peerB.statuses).toEqual(['connecting', 'connected']);
		expect(peerA.syncs).toEqual([true]);
		expect(peerB.syncs).toEqual([true]);

		peerA.doc.getMap<string>('shared').set('fromA', 'hello');
		await settle();
		expect(peerB.doc.getMap<string>('shared').get('fromA')).toBe('hello');

		peerB.doc.getMap<string>('shared').set('fromB', 'world');
		await settle();
		expect(peerA.doc.getMap<string>('shared').get('fromB')).toBe('world');
	});

	it('P2: auto-reconnects after a 1006 server drop with status and sync transitions', async () => {
		const relay = createMemRelay();
		const peerA = connectPeer(relay, 'room-p2');

		await settle();
		const firstDial = requireDial(relay, 0);
		const statusMark = peerA.statuses.length;
		const syncMark = peerA.syncs.length;

		relay.drop(firstDial.socket, 1006);
		await settle(FAST_BACKOFF_MS);

		expect(peerA.statuses.slice(statusMark)).toEqual(['disconnected', 'connecting', 'connected']);
		expect(peerA.syncs.slice(syncMark)).toEqual([false, true]);
		expect(relay.dials).toHaveLength(2);
		expect(requireDial(relay, 1).url).toBe(firstDial.url);
	});

	it('P3: merges offline edits made on both sides while disconnected', async () => {
		const relay = createMemRelay();
		const peerA = connectPeer(relay, 'room-p3');
		const peerB = connectPeer(relay, 'room-p3');

		await settle();

		relay.drop(activeSocket(peerA), 1006);
		expect(peerA.provider.wsconnected).toBe(false);

		peerA.doc.getMap<string>('notes').set('offlineA', 'from-a');
		peerB.doc.getMap<string>('notes').set('onlineB', 'from-b');
		await settle(0);
		expect(peerA.provider.wsconnected).toBe(false);

		await settle(FAST_BACKOFF_MS);
		expect(peerA.provider.synced).toBe(true);

		const stateA = snapshotMapViaUpdate(peerA.doc, 'notes');
		const stateB = snapshotMapViaUpdate(peerB.doc, 'notes');
		const stateRelay = snapshotMapViaUpdate(relay.docFor('room-p3'), 'notes');

		expect(stateA).toEqual({ offlineA: 'from-a', onlineB: 'from-b' });
		expect(stateB).toEqual(stateA);
		expect(stateRelay).toEqual(stateA);
	});

	it('P4: resolves a rotating token exactly once per dial', async () => {
		const relay = createMemRelay();
		const issued = ['tok1', 'tok2'];
		let resolverCalls = 0;
		const peerA = connectPeer(relay, 'room-p4', {
			auth: () => {
				const next = issued[resolverCalls] ?? 'unexpected';
				resolverCalls += 1;
				return next;
			},
		});

		await settle();
		expect(relay.dials).toHaveLength(1);
		expect(resolverCalls).toBe(1);
		expect(requireDial(relay, 0).url).toBe(`${SERVER_URL}/room-p4?token=tok1`);

		relay.drop(activeSocket(peerA), 1006);
		await settle(FAST_BACKOFF_MS);

		expect(relay.dials).toHaveLength(2);
		expect(resolverCalls).toBe(relay.dials.length);
		expect(requireDial(relay, 1).url).toBe(`${SERVER_URL}/room-p4?token=tok2`);
	});

	it('P5: keeps provider.params identity so a held reference reaches later dials', async () => {
		const relay = createMemRelay();
		let count = 0;
		const peerA = connectPeer(relay, 'room-p5', {
			params: { tenant: 't1' },
			auth: () => {
				count += 1;
				return `tok${count}`;
			},
		});

		await settle();
		const held = peerA.provider.params;
		relay.drop(activeSocket(peerA), 1006);
		await settle(FAST_BACKOFF_MS);

		expect(peerA.provider.params).toBe(held);
		held.tenant = 't2';
		relay.drop(activeSocket(peerA), 1006);
		await settle(FAST_BACKOFF_MS);

		expect(relay.dials).toHaveLength(3);
		expect(requireDial(relay, 1).url).toBe(`${SERVER_URL}/room-p5?tenant=t1&token=tok2`);
		expect(requireDial(relay, 2).url).toBe(`${SERVER_URL}/room-p5?tenant=t2&token=tok3`);
		expect(peerA.provider.params).toEqual({ tenant: 't2' });
	});
});

describe('connectProvider reconnection — negative', () => {
	it('N1: treats close code 4401 as terminal and does not reconnect', async () => {
		const relay = createMemRelay();
		const peerA = connectPeer(relay, 'room-n1');
		const closedEvents: Array<{ code: number; reason: string }> = [];
		peerA.provider.on('closed', (event) => {
			closedEvents.push(event);
		});

		await settle();

		relay.drop(activeSocket(peerA), 4401, 'unauthorized');
		expect(closedEvents).toEqual([{ code: 4401, reason: 'unauthorized' }]);
		expect(peerA.statuses.at(-1)).toBe('disconnected');

		await settle(10 * FAST_BACKOFF_MS);
		expect(relay.dials).toHaveLength(1);
		expect(peerA.statuses.at(-1)).toBe('disconnected');
	});

	it('N2: stops backoff timer and callbacks when disconnect() runs mid-backoff', async () => {
		const relay = createMemRelay();
		const peerA = connectPeer(relay, 'room-n2');

		await settle();
		relay.drop(activeSocket(peerA), 1006);
		await settle(10);
		expect(relay.dials).toHaveLength(1);

		const statusSnapshot = [...peerA.statuses];
		const syncSnapshot = [...peerA.syncs];

		peerA.disconnect();
		await settle(10 * FAST_BACKOFF_MS);

		expect(relay.dials).toHaveLength(1);
		expect(peerA.statuses).toEqual(statusSnapshot);
		expect(peerA.syncs).toEqual(syncSnapshot);
	});

	it('N3: strips query param and bearer subprotocol when token is revoked to null, keeping caller params', async () => {
		const relay = createMemRelay();
		let token: string | null = 'tok1';
		const peerA = connectPeer(relay, 'room-n3', {
			params: { tenant: 't1' },
			auth: {
				token: () => token,
				protocol: 'bearer',
			},
		});

		await settle();
		expect(requireDial(relay, 0).url).toBe(`${SERVER_URL}/room-n3?tenant=t1&token=tok1`);
		expect(requireDial(relay, 0).protocols).toEqual(['bearer.tok1']);

		token = null;
		relay.drop(activeSocket(peerA), 1006);
		await settle(FAST_BACKOFF_MS);

		const reconnectDial = requireDial(relay, 1);
		expect(reconnectDial.url).toBe(`${SERVER_URL}/room-n3?tenant=t1`);
		expect(reconnectDial.url).not.toContain('token');
		expect(reconnectDial.protocols.some((entry) => entry.startsWith('bearer.'))).toBe(false);
		expect(reconnectDial.protocols).toEqual([]);
	});

	it('N4: preserves caller subprotocols across multiple authenticated reconnects', async () => {
		const relay = createMemRelay();
		const RECONNECTS = 3;
		let count = 0;
		const peerA = connectPeer(relay, 'room-n4', {
			protocols: ['yjs-v1'],
			auth: {
				token: () => {
					count += 1;
					return `tok${count}`;
				},
				protocol: 'bearer',
			},
		});

		await settle();

		for (let i = 0; i < RECONNECTS; i += 1) {
			relay.drop(activeSocket(peerA), 1006);
			await settle(FAST_BACKOFF_MS);
		}

		expect(relay.dials).toHaveLength(RECONNECTS + 1);
		for (let i = 0; i <= RECONNECTS; i += 1) {
			const dial = requireDial(relay, i);
			const callerEntries = dial.protocols.filter((entry) => entry === 'yjs-v1');
			const bearerEntries = dial.protocols.filter((entry) => entry.startsWith('bearer.'));
			expect(callerEntries).toHaveLength(1);
			expect(bearerEntries).toEqual([`bearer.tok${i + 1}`]);
			expect(dial.protocols).toEqual(['yjs-v1', `bearer.tok${i + 1}`]);
		}
	});

	it('N6: keeps a caller subprotocol equal to an auth entry and never sends it twice', async () => {
		const relay = createMemRelay();
		const RECONNECTS = 2;
		const issued: Array<string | null> = ['tok1', 'tok2', null];
		let calls = 0;
		const peerA = connectPeer(relay, 'room-n6', {
			protocols: ['bearer.tok1'],
			auth: {
				token: () => {
					const next = issued[calls] ?? null;
					calls += 1;
					return next;
				},
				param: null,
				protocol: 'bearer',
			},
		});

		await settle();
		for (let i = 0; i < RECONNECTS; i += 1) {
			relay.drop(activeSocket(peerA), 1006);
			await settle(FAST_BACKOFF_MS);
		}

		expect(relay.dials).toHaveLength(RECONNECTS + 1);
		expect(requireDial(relay, 0).protocols).toEqual(['bearer.tok1']);
		expect(requireDial(relay, 1).protocols).toEqual(['bearer.tok1', 'bearer.tok2']);
		expect(requireDial(relay, 2).protocols).toEqual(['bearer.tok1']);
	});
	it('N7: refuses the dial, sends no anonymous request, and reconnects when the resolver throws', async () => {
		const relay = createMemRelay();
		const failure = new Error('token service down');
		const errors: unknown[] = [];
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		let calls = 0;
		const peerA = connectPeer(relay, 'room-n7', {
			params: { tenant: 't1' },
			protocols: ['yjs-v1'],
			auth: {
				token: () => {
					calls += 1;
					if (calls === 2) throw failure;
					return `tok${calls}`;
				},
				protocol: 'bearer',
			},
		});
		peerA.provider.on('connection-error', (event) => {
			errors.push((event as unknown as { readonly error: unknown }).error);
		});

		try {
			await settle();
			relay.drop(activeSocket(peerA), 1006);
			await settle(FAST_BACKOFF_MS);

			expect(errors).toEqual([failure]);
			expect(relay.dials).toHaveLength(1);
			expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('dial refused'), 'Error');

			await settle(FAST_BACKOFF_MS);
			expect(relay.dials).toHaveLength(2);
			expect(requireDial(relay, 1).url).toBe(`${SERVER_URL}/room-n7?tenant=t1&token=tok3`);
			expect(requireDial(relay, 1).protocols).toEqual(['yjs-v1', 'bearer.tok3']);
			expect(peerA.provider.synced).toBe(true);
		} finally {
			errorSpy.mockRestore();
		}
	});

	it('N8: tears the provider down and rethrows when onStatusChange throws on the first dial', async () => {
		const relay = createMemRelay();
		const failure = new Error('status listener failed');
		const statuses: ProviderStatus[] = [];
		const doc = new Y.Doc();
		teardowns.push(() => {
			doc.destroy();
		});
		let caught: unknown = null;
		try {
			connectProvider({
				url: SERVER_URL,
				room: 'room-n8',
				doc,
				disableBc: true,
				maxBackoffTime: FAST_BACKOFF_MS,
				WebSocketPolyfill: relay.Socket as unknown as typeof WebSocket,
				onStatusChange: (status) => {
					statuses.push(status);
					if (status === 'connecting') throw failure;
				},
			});
		} catch (error) {
			caught = error;
		}

		expect(caught).toBe(failure);
		expect(relay.dials).toHaveLength(1);
		const socket = requireDial(relay, 0).socket;
		expect(socket.readyState).toBe(socket.CLOSED);

		await settle(10 * FAST_BACKOFF_MS);
		expect(relay.dials).toHaveLength(1);
		expect(statuses).toEqual(['connecting']);
	});

	it('N10: falls back to the caller value of a param the token shadowed once the token is revoked', async () => {
		const relay = createMemRelay();
		let token: string | null = 'tok1';
		const peerA = connectPeer(relay, 'room-n10', {
			params: { token: 'guest' },
			auth: () => token,
		});

		await settle();
		expect(requireDial(relay, 0).url).toBe(`${SERVER_URL}/room-n10?token=tok1`);

		token = null;
		relay.drop(activeSocket(peerA), 1006);
		await settle(FAST_BACKOFF_MS);

		expect(requireDial(relay, 1).url).toBe(`${SERVER_URL}/room-n10?token=guest`);
	});

	it('N11: keeps reconnecting when a connection-error listener throws on a refused dial', async () => {
		const relay = createMemRelay();
		const listenerFailure = new Error('listener bug');
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		let calls = 0;
		const peerA = connectPeer(relay, 'room-n11', {
			auth: () => {
				calls += 1;
				if (calls === 2) throw new Error('token service down');
				return `tok${calls}`;
			},
		});
		peerA.provider.on('connection-error', () => {
			throw listenerFailure;
		});

		try {
			await settle();
			relay.drop(activeSocket(peerA), 1006);
			await settle(FAST_BACKOFF_MS);
			await settle(FAST_BACKOFF_MS);

			expect(relay.dials).toHaveLength(2);
			expect(requireDial(relay, 1).url).toBe(`${SERVER_URL}/room-n11?token=tok3`);
			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining('socket event handler threw'),
				'Error',
			);
		} finally {
			errorSpy.mockRestore();
		}
	});

	it('N12: sends a caller update under the auth key once the token is revoked', async () => {
		const relay = createMemRelay();
		let token: string | null = 'tok1';
		const peerA = connectPeer(relay, 'room-n12', {
			params: { token: 'guest' },
			auth: () => token,
		});

		await settle();
		expect(requireDial(relay, 0).url).toBe(`${SERVER_URL}/room-n12?token=tok1`);
		expect(peerA.provider.params).toEqual({ token: 'guest' });

		peerA.provider.params.token = 'guest2';
		token = null;
		relay.drop(activeSocket(peerA), 1006);
		await settle(FAST_BACKOFF_MS);

		expect(requireDial(relay, 1).url).toBe(`${SERVER_URL}/room-n12?token=guest2`);
	});
});

describe('connectProvider held-back connect', () => {
	it('N5: connect: false dials nothing until provider.connect(), then reports connecting first', async () => {
		const relay = createMemRelay();
		const peerA = connectPeer(relay, 'room-n5', { connect: false });

		await settle(10 * FAST_BACKOFF_MS);
		expect(relay.dials).toHaveLength(0);
		expect(peerA.statuses).toEqual([]);

		peerA.provider.connect();
		await settle();
		expect(relay.dials).toHaveLength(1);
		expect(peerA.statuses).toEqual(['connecting', 'connected']);
		expect(peerA.syncs).toEqual([true]);
	});
	it('P6: resolves the token when the held-back first dial goes out, not at construction', async () => {
		const relay = createMemRelay();
		let token = 'tok1';
		const peerA = connectPeer(relay, 'room-p6', { connect: false, auth: () => token });
		expect(peerA.provider.params).toEqual({});

		token = 'tok2';
		await settle(10 * FAST_BACKOFF_MS);
		peerA.provider.connect();
		await settle();

		expect(relay.dials).toHaveLength(1);
		expect(requireDial(relay, 0).url).toBe(`${SERVER_URL}/room-p6?token=tok2`);
	});

	it('N9: dials without credentials when the token is revoked before a held-back connect', async () => {
		const relay = createMemRelay();
		let token: string | null = 'tok1';
		const peerA = connectPeer(relay, 'room-n9', {
			connect: false,
			protocols: ['yjs-v1'],
			auth: { token: () => token, protocol: 'bearer' },
		});

		token = null;
		peerA.provider.connect();
		await settle();

		expect(relay.dials).toHaveLength(1);
		expect(requireDial(relay, 0).url).toBe(`${SERVER_URL}/room-n9`);
		expect(requireDial(relay, 0).protocols).toEqual(['yjs-v1']);
	});
});

describe('connectProvider reconnection — boundary', () => {
	it('B1: recovers and converges when dropped right after open before sync completes', async () => {
		const relay = createMemRelay();
		const peerB = connectPeer(relay, 'room-b1');
		await settle();
		peerB.doc.getMap<string>('data').set('fromB', 'seeded');
		await settle(0);

		const docA = new Y.Doc();
		docA.getMap<string>('data').set('fromA', 'pending');
		const peerA = connectPeer(relay, 'room-b1', { doc: docA });
		const firstSocketA = requireDial(relay, 1).socket;

		await new Promise<void>((resolve) => {
			queueMicrotask(resolve);
		});
		expect(peerA.provider.wsconnected).toBe(true);
		expect(peerA.provider.synced).toBe(false);

		relay.drop(firstSocketA, 1006, 'pre-sync');
		await settle(FAST_BACKOFF_MS);

		expect(peerA.syncs).toEqual([true]);
		expect(peerA.doc.getMap<string>('data').toJSON()).toEqual({
			fromA: 'pending',
			fromB: 'seeded',
		});
		expect(peerB.doc.getMap<string>('data').toJSON()).toEqual({
			fromA: 'pending',
			fromB: 'seeded',
		});
	});

	it('B2: converges across CYCLES = 5 drop/reconnect cycles with edits on both peers', async () => {
		const relay = createMemRelay();
		const CYCLES = 5;
		const peerA = connectPeer(relay, 'room-b2', { params: { peer: 'a' } });
		const peerB = connectPeer(relay, 'room-b2', { params: { peer: 'b' } });

		await settle();

		const expectedEntries: string[] = [];
		for (let cycle = 0; cycle < CYCLES; cycle += 1) {
			relay.drop(activeSocket(peerA), 1006);
			const entryA = `a-${cycle}`;
			const entryB = `b-${cycle}`;
			expectedEntries.push(entryA, entryB);
			peerA.doc.getArray<string>('events').push([entryA]);
			peerB.doc.getArray<string>('events').push([entryB]);
			await settle(0);
			await settle(FAST_BACKOFF_MS);
		}

		const dialsForA = relay.dials.filter((dial) => dial.url.endsWith('?peer=a'));
		expect(dialsForA).toHaveLength(CYCLES + 1);

		const itemsA = peerA.doc.getArray<string>('events').toArray();
		const itemsB = peerB.doc.getArray<string>('events').toArray();
		const itemsRelay = relay.docFor('room-b2').getArray<string>('events').toArray();
		expect(itemsA).toEqual(itemsB);
		expect(itemsA).toEqual(itemsRelay);
		expect([...itemsA].sort()).toEqual([...expectedEntries].sort());
		expect(relay.dials).toHaveLength(CYCLES + 2);
		// Only the open sockets stay; peer A redialled last, so its socket comes second.
		expect(relay.sockets).toEqual([activeSocket(peerB), activeSocket(peerA)]);
	});

	it('B3: caps reconnect backoff at maxBackoffTime across consecutive refusals', async () => {
		const relay = createMemRelay();
		const REFUSALS = 4;
		const MAX_BACKOFF_MS = 400;
		relay.refuseNext(REFUSALS);

		const peerA = connectPeer(relay, 'room-b3', {
			maxBackoffTime: MAX_BACKOFF_MS,
		});

		await settle(0);
		expect(relay.dials).toHaveLength(1);

		for (let k = 1; k <= REFUSALS; k += 1) {
			const delayMs = k === 1 ? 200 : MAX_BACKOFF_MS;
			await settle(delayMs - 1);
			expect(relay.dials).toHaveLength(k);
			await settle(1);
			expect(relay.dials).toHaveLength(k + 1);
		}

		expect(peerA.provider.synced).toBe(true);
	});
});
