/**
 * Reconnection suite for `connectProvider` / `bindProviderAuth` (gap audit C14-6).
 *
 * Guards provider recovery across real WebSocket disconnects: status transitions,
 * `onSync` resets, offline CRDT edit convergence, a token resolved at every dial
 * (rotation, revocation, a held-back first dial), a refused dial when the
 * resolver throws, caller params and subprotocols kept and read at every dial,
 * teardown when the first dial throws, status and sync callbacks that throw
 * later, a socket the client closes itself, terminal 44xx closes, backoff
 * capping, and closed sockets leaving the relay.
 * Uses the deterministic in-memory `y-protocols/sync` relay (`./mem-relay.js`)
 * and Vitest fake timers — no network sockets or wall-clock sleeps.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { ProblemError } from '@sveltesentio/core/problem';
import {
	type AuthBinding,
	type ConnectedProvider,
	type ProviderStatus,
	COLLAB_START_FAILED_TYPE,
	bindProviderAuth,
	connectProvider,
} from '../src/provider.js';
import {
	type MemDial,
	type MemRelay,
	type MemSocket,
	createMemRelay,
	nextTask,
} from './mem-relay.js';

const SERVER_URL = 'ws://localhost:1234';
const FAST_BACKOFF_MS = 50;
/** Relay tasks a settle runs after the clock advance: a sync round trip is a few hops. */
const RELAY_TASK_STEPS = 16;

interface PeerOptions {
	readonly doc?: Y.Doc;
	readonly params?: Readonly<Record<string, string>>;
	readonly protocols?: readonly string[];
	readonly auth?: AuthBinding | string | (() => string | null | undefined);
	readonly maxBackoffTime?: number;
	readonly connect?: boolean;
	readonly onStatusChange?: (status: ProviderStatus) => void;
	readonly onSync?: (synced: boolean) => void;
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
	// The relay fires socket events as `setImmediate` tasks (`queueTask` in
	// mem-relay.ts), kept real so they never move the fake clock.
	vi.useFakeTimers({ toNotFake: ['setImmediate', 'clearImmediate'] });
});

afterEach(() => {
	for (const cleanup of teardowns.splice(0)) {
		cleanup();
	}
	vi.useRealTimers();
});

async function settle(ms = 0): Promise<void> {
	await vi.advanceTimersByTimeAsync(ms);
	for (let i = 0; i < RELAY_TASK_STEPS; i += 1) {
		await nextTask();
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

/** `count` distinct caller subprotocols, the most a dial takes before auth adds its own. */
function callerProtocols(count: number): string[] {
	return Array.from({ length: count }, (_, i) => `p${String(i)}`);
}

/**
 * A y-websocket provider built with its default `connect: true`, so its
 * constructor dials before any binding; destroyed at teardown.
 */
function autoConnectedProvider(relay: MemRelay, room: string): WebsocketProvider {
	const doc = new Y.Doc();
	const provider = new WebsocketProvider(SERVER_URL, room, doc, {
		disableBc: true,
		maxBackoffTime: FAST_BACKOFF_MS,
		WebSocketPolyfill: relay.Socket as unknown as typeof WebSocket,
	});
	teardowns.push(() => {
		provider.destroy();
		doc.destroy();
	});
	return provider;
}

describe('connectProvider reconnection — positive — connect and drop', () => {
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
});

describe('connectProvider reconnection — positive — offline edits', () => {
	it('P3: merges offline edits made on both sides while disconnected', async () => {
		const relay = createMemRelay();
		const peerA = connectPeer(relay, 'room-p3');
		const peerB = connectPeer(relay, 'room-p3');

		await settle();

		relay.drop(activeSocket(peerA), 1006);
		// The close fires one task later, as a browser's does.
		expect(peerA.provider.wsconnected).toBe(true);
		await nextTask();
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
});

describe('connectProvider reconnection — positive — token per dial', () => {
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

describe('connectProvider reconnection — negative — terminal close and disconnect', () => {
	it('N1: treats close code 4401 as terminal and does not reconnect', async () => {
		const relay = createMemRelay();
		const peerA = connectPeer(relay, 'room-n1');
		const closedEvents: Array<{ code: number; reason: string }> = [];
		peerA.provider.on('closed', (event) => {
			closedEvents.push(event);
		});

		await settle();

		relay.drop(activeSocket(peerA), 4401, 'unauthorized');
		expect(closedEvents).toEqual([]);
		await nextTask();
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
});

describe('connectProvider reconnection — negative — auth across reconnects, part 1', () => {
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
});

describe('connectProvider reconnection — negative — auth across reconnects, part 2', () => {
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
});

describe('connectProvider reconnection — negative — refused dials', () => {
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
			errors.push(event);
		});

		try {
			await settle();
			relay.drop(activeSocket(peerA), 1006);
			await settle(FAST_BACKOFF_MS);

			// The drop's own error event, then the refused dial's plain one.
			expect(errors).toHaveLength(2);
			expect(errors[0]).toEqual({ type: 'error' });
			expect(errors[1]).toBeInstanceOf(Event);
			expect(errors[1]).not.toHaveProperty('error');
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
});

describe('connectProvider reconnection — negative — first dial, part 1', () => {
	it('N8: tears the provider down and throws a problem error when onStatusChange throws on the first dial', async () => {
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

		expect(caught).toBeInstanceOf(ProblemError);
		const problem = caught as ProblemError;
		expect(problem.type).toBe(COLLAB_START_FAILED_TYPE);
		expect(problem.cause).toBe(failure);
		expect(problem.detail).toBe('the first dial threw (Error); the provider was torn down');
		expect(problem.message).not.toContain(failure.message);
		expect(relay.dials).toHaveLength(1);
		const socket = requireDial(relay, 0).socket;
		expect(socket.readyState).toBe(socket.CLOSING);

		await settle(10 * FAST_BACKOFF_MS);
		expect(socket.readyState).toBe(socket.CLOSED);
		expect(relay.dials).toHaveLength(1);
		expect(statuses).toEqual(['connecting']);
	});
});

describe('connectProvider reconnection — negative — first dial, part 2', () => {
	it('N18: tears the provider down and throws a problem error when the first dial is refused permanently', async () => {
		const relay = createMemRelay();
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const doc = new Y.Doc();
		teardowns.push(() => {
			doc.destroy();
		});
		let caught: unknown = null;
		try {
			connectProvider({
				url: SERVER_URL,
				room: 'room-n18',
				doc,
				disableBc: true,
				maxBackoffTime: FAST_BACKOFF_MS,
				WebSocketPolyfill: relay.Socket as unknown as typeof WebSocket,
				protocols: callerProtocols(4000),
				auth: { token: 'tok', param: null, protocol: 'bearer' },
			});
		} catch (error) {
			caught = error;
		} finally {
			errorSpy.mockRestore();
		}

		expect(caught).toBeInstanceOf(ProblemError);
		const problem = caught as ProblemError;
		expect(problem.type).toBe(COLLAB_START_FAILED_TYPE);
		expect(problem.detail).toBe(
			'the first dial was refused (dial exceeds the query pair or subprotocol bound); the provider was torn down',
		);
		await settle(10 * FAST_BACKOFF_MS);
		expect(relay.dials).toHaveLength(0);
	});
});

describe('connectProvider reconnection — negative — first dial, part 3', () => {
	it('N20: keeps a provider whose first dial is refused for now (resolver throws), and connects after the backoff (boundary)', async () => {
		const relay = createMemRelay();
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		let calls = 0;
		try {
			const peerA = connectPeer(relay, 'room-n20', {
				auth: () => {
					calls += 1;
					if (calls === 1) throw new Error('token service down');
					return `tok${calls}`;
				},
			});
			await settle();
			expect(relay.dials).toHaveLength(0);
			expect(errorSpy).toHaveBeenCalledWith(
				'[sentio] collab: auth token resolver threw; dial refused:',
				'Error',
			);
			expect(peerA.provider.shouldConnect).toBe(true);

			await settle(FAST_BACKOFF_MS);
			expect(relay.dials).toHaveLength(1);
			expect(requireDial(relay, 0).url).toBe(`${SERVER_URL}/room-n20?token=tok2`);
			expect(peerA.provider.synced).toBe(true);
		} finally {
			errorSpy.mockRestore();
		}
	});
});

describe('connectProvider reconnection — negative — after disconnect', () => {
	it.each([
		['after the first dial', true, 1],
		['held back, before any dial (boundary)', false, 0],
	] as const)(
		'N21: sends nothing when provider.connect() runs after disconnect() on an auth-bound provider (%s)',
		async (_label, connect, dials) => {
			const relay = createMemRelay();
			const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
			try {
				const peerA = connectPeer(relay, 'room-n21', { auth: 'tok', connect });
				await settle();
				expect(relay.dials).toHaveLength(dials);

				peerA.disconnect();
				await settle(10 * FAST_BACKOFF_MS);
				peerA.provider.connect();
				await settle(10 * FAST_BACKOFF_MS);

				expect(relay.dials).toHaveLength(dials);
				expect(relay.sockets).toEqual([]);
				expect(peerA.provider.shouldConnect).toBe(false);
				expect(errorSpy).toHaveBeenCalledTimes(1);
				expect(errorSpy).toHaveBeenCalledWith(
					'[sentio] collab: provider disconnected by connectProvider; dial refused, provider stopped until connect() is called',
				);
			} finally {
				errorSpy.mockRestore();
			}
		},
	);

	it('N25: builds no socket when the token resolver runs disconnect() before it returns a token', async () => {
		const relay = createMemRelay();
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const handle: { teardown?: () => void } = {};
		let calls = 0;
		const auth = (): string => {
			calls += 1;
			handle.teardown?.();
			return 'tok';
		};
		try {
			const peerA = connectPeer(relay, 'room-n25', { auth, connect: false });
			handle.teardown = peerA.disconnect;
			peerA.provider.connect();
			await settle(10 * FAST_BACKOFF_MS);

			expect(calls).toBe(1);
			expect(relay.dials).toEqual([]);
			expect(relay.sockets).toEqual([]);
			expect(peerA.provider.shouldConnect).toBe(false);
			expect(errorSpy.mock.calls).toEqual([
				[
					'[sentio] collab: provider disconnected by connectProvider; dial refused, provider stopped until connect() is called',
				],
			]);
		} finally {
			errorSpy.mockRestore();
		}
	});
});

describe('connectProvider reconnection — negative — disconnect from a reconnect status', () => {
	it('N26: leaves no socket open when onStatusChange runs disconnect() on a reconnect, without auth', async () => {
		const relay = createMemRelay();
		const handle: { teardown?: () => void } = {};
		let connecting = 0;
		// y-websocket's setupWS (2.0.4 to 3.1.0) builds the socket and stores it as
		// provider.ws before it emits `connecting`, so the teardown closes that socket.
		const onStatusChange = (status: ProviderStatus): void => {
			if (status !== 'connecting') return;
			connecting += 1;
			if (connecting === 2) handle.teardown?.();
		};
		const peerA = connectPeer(relay, 'room-n26', { onStatusChange });
		handle.teardown = peerA.disconnect;
		await settle();
		expect(relay.dials).toHaveLength(1);

		relay.drop(activeSocket(peerA), 1006);
		await settle(FAST_BACKOFF_MS);
		expect(connecting).toBe(2);
		expect(relay.dials).toHaveLength(2);
		expect(relay.sockets).toEqual([]);
		expect(peerA.provider.ws).toBeNull();
		expect(peerA.provider.shouldConnect).toBe(false);

		await settle(10 * FAST_BACKOFF_MS);
		expect(relay.dials).toHaveLength(2);
		expect(relay.sockets).toEqual([]);
	});
});

/** A socket that accepts the dial and throws on `close()`, as a broken polyfill can. */
class CloseThrowsSocket {
	static dials = 0;
	readonly CONNECTING = 0;
	readonly OPEN = 1;
	readonly CLOSING = 2;
	readonly CLOSED = 3;
	readyState = 0;
	binaryType = 'blob';
	onopen: unknown = null;
	onclose: unknown = null;
	onerror: unknown = null;
	onmessage: unknown = null;
	constructor(readonly url: string) {
		CloseThrowsSocket.dials += 1;
	}
	send(): void {}
	close(): void {
		throw new RangeError('close failed');
	}
}

describe('connectProvider reconnection — negative — teardown that throws', () => {
	it('N22: names a throwing teardown in the start error and still destroys the provider', () => {
		const destroySpy = vi.spyOn(WebsocketProvider.prototype, 'destroy');
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const doc = new Y.Doc();
		CloseThrowsSocket.dials = 0;
		let caught: unknown = null;
		let destroyed: number;
		try {
			connectProvider({
				url: SERVER_URL,
				room: 'room-n22',
				doc,
				disableBc: true,
				WebSocketPolyfill: CloseThrowsSocket as unknown as typeof WebSocket,
				onStatusChange: (status) => {
					if (status === 'connecting') throw new TypeError('connecting');
				},
			});
		} catch (error) {
			caught = error;
		} finally {
			destroyed = destroySpy.mock.calls.length;
			errorSpy.mockRestore();
			destroySpy.mockRestore();
			doc.destroy();
		}

		expect(caught).toBeInstanceOf(ProblemError);
		const problem = caught as ProblemError;
		expect(problem.type).toBe(COLLAB_START_FAILED_TYPE);
		expect(problem.detail).toBe(
			'the first dial threw (TypeError); tearing the provider down threw (RangeError)',
		);
		expect(destroyed).toBe(1);
		expect(CloseThrowsSocket.dials).toBe(1);
	});

	it('N22: destroys the provider when disconnect() meets a socket close() that throws (negative)', async () => {
		const destroySpy = vi.spyOn(WebsocketProvider.prototype, 'destroy');
		const doc = new Y.Doc();
		CloseThrowsSocket.dials = 0;
		try {
			const { provider, disconnect } = connectProvider({
				url: SERVER_URL,
				room: 'room-n22b',
				doc,
				disableBc: true,
				maxBackoffTime: FAST_BACKOFF_MS,
				WebSocketPolyfill: CloseThrowsSocket as unknown as typeof WebSocket,
			});
			expect(disconnect).toThrow(RangeError);
			expect(destroySpy).toHaveBeenCalledTimes(1);
			expect(provider.shouldConnect).toBe(false);
			await settle(10 * FAST_BACKOFF_MS);
			expect(CloseThrowsSocket.dials).toBe(1);
		} finally {
			destroySpy.mockRestore();
			doc.destroy();
		}
	});
});

describe('connectProvider reconnection — negative — detach that throws', () => {
	it.each([['status'], ['sync (boundary)']] as const)(
		'N24: calls no callback after disconnect() when provider.off throws for %s',
		async (label) => {
			const failing = label === 'status' ? 'status' : 'sync';
			const relay = createMemRelay();
			const destroySpy = vi.spyOn(WebsocketProvider.prototype, 'destroy');
			try {
				const peerA = connectPeer(relay, `room-n24-${failing}`);
				await settle();
				expect(peerA.statuses).toEqual(['connecting', 'connected']);
				expect(peerA.syncs).toEqual([true]);

				const { provider } = peerA;
				const realOff = provider.off.bind(provider);
				const offNames: string[] = [];
				const failingOff: typeof provider.off = (name, handler) => {
					offNames.push(name);
					if (name === failing) throw new RangeError('off failed');
					realOff(name, handler);
				};
				Object.defineProperty(provider, 'off', { value: failingOff });

				expect(peerA.disconnect).toThrow(RangeError);
				expect(offNames).toEqual(['status', 'sync']);
				expect(destroySpy).toHaveBeenCalledTimes(1);
				await settle(10 * FAST_BACKOFF_MS);
				// The disconnect emitted `disconnected` and a sync reset to the listener
				// `off` failed to remove; neither reached the caller callbacks.
				expect(peerA.statuses).toEqual(['connecting', 'connected']);
				expect(peerA.syncs).toEqual([true]);
				expect(relay.dials).toHaveLength(1);
			} finally {
				destroySpy.mockRestore();
			}
		},
	);
});

describe('connectProvider reconnection — negative — fixed token that cannot be encoded', () => {
	it.each([
		['a lone surrogate in the query token', 'tok\uD800'],
		['a subprotocol token outside RFC 6455', { token: 'a b', param: null, protocol: 'bearer' }],
	] as const)(
		'N23: tears the provider down and throws a problem error on a fixed token with %s',
		async (_label, auth) => {
			const relay = createMemRelay();
			const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
			const doc = new Y.Doc();
			teardowns.push(() => {
				doc.destroy();
			});
			let caught: unknown = null;
			try {
				connectProvider({
					url: SERVER_URL,
					room: 'room-n23',
					doc,
					disableBc: true,
					maxBackoffTime: FAST_BACKOFF_MS,
					WebSocketPolyfill: relay.Socket as unknown as typeof WebSocket,
					auth,
				});
			} catch (error) {
				caught = error;
			} finally {
				errorSpy.mockRestore();
			}

			expect(caught).toBeInstanceOf(ProblemError);
			const problem = caught as ProblemError;
			expect(problem.type).toBe(COLLAB_START_FAILED_TYPE);
			expect(problem.detail).toBe(
				'the first dial was refused (fixed auth token cannot be encoded for the dial); the provider was torn down',
			);
			await settle(10 * FAST_BACKOFF_MS);
			expect(relay.dials).toHaveLength(0);
		},
	);

	it('N23: keeps retrying a resolver whose token cannot be encoded, and dials once it can (boundary)', async () => {
		const relay = createMemRelay();
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		let token = 'tok\uD800';
		try {
			const peerA = connectPeer(relay, 'room-n23b', { auth: () => token });
			await settle();
			expect(relay.dials).toHaveLength(0);
			expect(peerA.provider.shouldConnect).toBe(true);
			expect(errorSpy).toHaveBeenCalledWith(
				'[sentio] collab: auth token cannot be encoded for the dial; dial refused:',
				'URIError',
			);

			token = 'tok';
			await settle(FAST_BACKOFF_MS);
			expect(relay.dials.map((dial) => dial.url)).toEqual([`${SERVER_URL}/room-n23b?token=tok`]);
		} finally {
			errorSpy.mockRestore();
		}
	});
});

describe('connectProvider reconnection — negative — caller fallback, part 1', () => {
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
});

describe('connectProvider reconnection — negative — throwing listeners, part 1', () => {
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
			// A close frame from the server (1001) fires no error event, so the
			// refused dial's is the only one the listener sees.
			relay.drop(activeSocket(peerA), 1001, 'going away');
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
});

describe('connectProvider reconnection — negative — caller fallback, part 2', () => {
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

describe('connectProvider reconnection — negative — throwing listeners, part 2', () => {
	it('N13: keeps reconnecting when onStatusChange throws after the first dial, logging each throw', async () => {
		const relay = createMemRelay();
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const statuses: ProviderStatus[] = [];
		try {
			const peerA = connectPeer(relay, 'room-n13', {
				onStatusChange: (status) => {
					statuses.push(status);
					if (statuses.length > 1) throw new TypeError(`status ${status} for tok-secret`);
				},
			});
			await settle();
			relay.drop(activeSocket(peerA), 1006);
			await settle(FAST_BACKOFF_MS);

			expect(relay.dials).toHaveLength(2);
			expect(peerA.provider.wsconnected).toBe(true);
			expect(peerA.provider.synced).toBe(true);
			expect(statuses).toEqual([
				'connecting',
				'connected',
				'disconnected',
				'connecting',
				'connected',
			]);
			expect(errorSpy).toHaveBeenCalledTimes(4);
			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining('onStatusChange callback threw'),
				'TypeError',
			);
			expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('tok-secret');
		} finally {
			errorSpy.mockRestore();
		}
	});
});

describe('connectProvider reconnection — negative — throwing listeners, part 3', () => {
	it('N14: keeps reconnecting when onSync throws on the sync reset of a drop', async () => {
		const relay = createMemRelay();
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const syncs: boolean[] = [];
		try {
			const peerA = connectPeer(relay, 'room-n14', {
				onSync: (synced) => {
					syncs.push(synced);
					if (!synced) throw new RangeError('sync reset');
				},
			});
			await settle();
			relay.drop(activeSocket(peerA), 1006);
			await settle(FAST_BACKOFF_MS);

			expect(relay.dials).toHaveLength(2);
			expect(syncs).toEqual([true, false, true]);
			expect(peerA.statuses).toEqual([
				'connecting',
				'connected',
				'disconnected',
				'connecting',
				'connected',
			]);
			expect(errorSpy).toHaveBeenCalledTimes(1);
			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining('onSync callback threw'),
				'RangeError',
			);
		} finally {
			errorSpy.mockRestore();
		}
	});
});

describe('connectProvider reconnection — negative — own close and early dial', () => {
	it('N16: redials after the client closes its own socket', async () => {
		const relay = createMemRelay();
		const peerA = connectPeer(relay, 'room-n16');
		await settle();
		const statusMark = peerA.statuses.length;

		activeSocket(peerA).close();
		await settle(FAST_BACKOFF_MS);

		expect(relay.dials).toHaveLength(2);
		expect(peerA.statuses.slice(statusMark)).toEqual(['disconnected', 'connecting', 'connected']);
		expect(peerA.syncs).toEqual([true, false, true]);
		expect(relay.sockets).toEqual([requireDial(relay, 1).socket]);
	});

	it.each([
		['still connecting', 0],
		['open', 1],
	] as const)(
		'N17: stops a provider that dialed before bindProviderAuth (%s); connect() then dials with the token',
		async (_label, settlesBeforeBind) => {
			const relay = createMemRelay();
			const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
			const provider = autoConnectedProvider(relay, 'room-n17');
			try {
				if (settlesBeforeBind > 0) await settle();
				expect(relay.dials).toHaveLength(1);
				bindProviderAuth(provider, 'tok');
				expect(errorSpy).toHaveBeenCalledTimes(1);
				expect(provider.shouldConnect).toBe(false);
				await settle(10 * FAST_BACKOFF_MS);
				expect(relay.dials).toHaveLength(1);
				const first = requireDial(relay, 0).socket;
				expect(first.readyState).toBe(first.CLOSED);
				expect(provider.wsconnected).toBe(false);

				provider.connect();
				await settle();
				expect(relay.dials.map((dial) => dial.url)).toEqual([
					`${SERVER_URL}/room-n17`,
					`${SERVER_URL}/room-n17?token=tok`,
				]);
				expect(provider.wsconnected).toBe(true);
			} finally {
				errorSpy.mockRestore();
			}
		},
	);
});

describe('connectProvider reconnection — negative — own close and early dial, part 2', () => {
	it('N17: dials with the token when connect() runs right after bindProviderAuth, before the stopped socket closes (boundary)', async () => {
		const relay = createMemRelay();
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const provider = autoConnectedProvider(relay, 'room-n17b');
		try {
			await settle();
			bindProviderAuth(provider, 'tok');
			// The stopped socket is still `provider.ws` until its close event runs,
			// so this connect() dials nothing itself; y-websocket's onclose then
			// schedules `setupWS`, which dials once `shouldConnect` is set again.
			provider.connect();
			expect(relay.dials).toHaveLength(1);

			await settle(10 * FAST_BACKOFF_MS);
			expect(relay.dials.map((dial) => dial.url)).toEqual([
				`${SERVER_URL}/room-n17b`,
				`${SERVER_URL}/room-n17b?token=tok`,
			]);
			expect(provider.wsconnected).toBe(true);
			expect(provider.shouldConnect).toBe(true);
		} finally {
			errorSpy.mockRestore();
		}
	});
});

describe('connectProvider held-back connect — status', () => {
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

	it('N15: logs a throwing onStatusChange on a held-back provider.connect() and still dials', async () => {
		const relay = createMemRelay();
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			const peerA = connectPeer(relay, 'room-n15', {
				connect: false,
				onStatusChange: (status) => {
					if (status === 'connecting') throw new TypeError('connecting');
				},
			});
			expect(() => {
				peerA.provider.connect();
			}).not.toThrow();
			await settle();

			expect(relay.dials).toHaveLength(1);
			expect(peerA.provider.wsconnected).toBe(true);
			expect(errorSpy).toHaveBeenCalledTimes(1);
			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining('onStatusChange callback threw'),
				'TypeError',
			);
		} finally {
			errorSpy.mockRestore();
		}
	});
});

describe('connectProvider held-back connect — token', () => {
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

	it('N19: stops a held-back provider whose dial is refused permanently, until connect() is called again', async () => {
		const relay = createMemRelay();
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			const peerA = connectPeer(relay, 'room-n19', {
				connect: false,
				protocols: callerProtocols(4000),
				auth: { token: 'tok', param: null, protocol: 'bearer' },
			});
			peerA.provider.connect();
			await settle(10 * FAST_BACKOFF_MS);

			expect(relay.dials).toHaveLength(0);
			expect(peerA.provider.shouldConnect).toBe(false);
			expect(errorSpy).toHaveBeenCalledTimes(1);
			expect(errorSpy).toHaveBeenCalledWith(
				'[sentio] collab: dial exceeds the query pair or subprotocol bound; dial refused, provider stopped until connect() is called',
			);
		} finally {
			errorSpy.mockRestore();
		}
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

describe('connectProvider reconnection — boundary — convergence', () => {
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

		await nextTask();
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
});

describe('connectProvider reconnection — boundary — backoff', () => {
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
