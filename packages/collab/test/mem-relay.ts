import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';

const MESSAGE_SYNC = 0;

/**
 * Default cap on open relay sockets. Each update fans out over the open
 * sockets, so the cap bounds that loop (HISS-02, HISS-06); the suites open at
 * most two peers at once.
 */
const DEFAULT_MAX_SOCKETS = 16;

/**
 * The Node global the relay schedules with. Collab type-checks without
 * `@types/node`, which would also expose Node globals to `src/`, so the one
 * signature used here is declared locally.
 */
interface ImmediateHost {
	setImmediate(run: () => void): unknown;
}

/**
 * Queues `run` as a task, as a browser fires WebSocket `open`, `message` and
 * `close` events: WHATWG WebSockets Standard §4 "Feedback from the protocol"
 * queues a task for each. Node runs a `setImmediate` callback as a macrotask,
 * after the microtask queue drains, so a promise continuation queued before an
 * event runs before it. Suites that fake timers keep `setImmediate` real
 * (`toNotFake`), so relay tasks never move the fake clock. Tests:
 * `test/mem-relay.test.ts` "fires open one task after the dial, after pending
 * microtasks".
 */
function queueTask(run: () => void): void {
	(globalThis as unknown as ImmediateHost).setImmediate(run);
}

/** Resolves once every relay task queued before the call has run. */
export function nextTask(): Promise<void> {
	return new Promise((resolve) => {
		queueTask(resolve);
	});
}

export interface MemRelayOptions {
	/** Open sockets the relay admits; a dial past it closes with 1013. Defaults to 16. */
	readonly maxSockets?: number;
}

export interface MemCloseEvent {
	readonly code: number;
	readonly reason: string;
}

export interface MemMessageEvent {
	readonly data: ArrayBuffer;
}

export interface MemSocket {
	readonly CONNECTING: 0;
	readonly OPEN: 1;
	readonly CLOSING: 2;
	readonly CLOSED: 3;
	readonly url: string;
	readonly protocols: string[];
	readonly room: string;
	readyState: number;
	binaryType: string;
	onopen: (() => void) | null;
	onmessage: ((event: MemMessageEvent) => void) | null;
	onclose: ((event: MemCloseEvent) => void) | null;
	onerror: ((event: unknown) => void) | null;
	send(data: ArrayBuffer | Uint8Array): void;
	close(): void;
}

export interface MemSocketConstructor {
	readonly CONNECTING: 0;
	readonly OPEN: 1;
	readonly CLOSING: 2;
	readonly CLOSED: 3;
	new (url: string | URL, protocols?: string | string[]): MemSocket;
}

export interface MemDial {
	readonly url: string;
	readonly protocols: string[];
	readonly socket: MemSocket;
}

export interface MemRelay {
	readonly Socket: MemSocketConstructor;
	/** Sockets connecting or open, at most `maxSockets`; a socket leaves once `close()` is called, or on a drop or a refusal. */
	readonly sockets: readonly MemSocket[];
	/** Every dial, kept as the assertion log of the one test that owns the relay. */
	readonly dials: readonly MemDial[];
	docFor(room: string): Y.Doc;
	drop(socket: MemSocket, code?: number, reason?: string): void;
	refuseNext(count: number): void;
}

function parseRoom(rawUrl: string): string {
	const withoutQuery = rawUrl.split('?')[0] ?? rawUrl;
	const slashIndex = withoutQuery.lastIndexOf('/');
	const segment = slashIndex >= 0 ? withoutQuery.slice(slashIndex + 1) : withoutQuery;
	return decodeURIComponent(segment);
}

function normaliseProtocols(protocols?: string | string[]): string[] {
	if (protocols === undefined) return [];
	return typeof protocols === 'string' ? [protocols] : [...protocols];
}

function toBytes(data: ArrayBuffer | Uint8Array): Uint8Array {
	return data instanceof Uint8Array ? data.slice() : new Uint8Array(data.slice(0));
}

function deliverToClient(socket: MemSocket, payload: Uint8Array): void {
	const copy = payload.slice();
	queueTask(() => {
		if (socket.readyState !== socket.OPEN) return;
		socket.onmessage?.({ data: copy.buffer });
	});
}

function encodeSyncStep1(doc: Y.Doc): Uint8Array {
	const encoder = encoding.createEncoder();
	encoding.writeVarUint(encoder, MESSAGE_SYNC);
	syncProtocol.writeSyncStep1(encoder, doc);
	return encoding.toUint8Array(encoder);
}

function encodeUpdateFrame(update: Uint8Array): Uint8Array {
	const encoder = encoding.createEncoder();
	encoding.writeVarUint(encoder, MESSAGE_SYNC);
	syncProtocol.writeUpdate(encoder, update);
	return encoding.toUint8Array(encoder);
}

function handleClientFrame(roomDoc: Y.Doc, socket: MemSocket, frame: Uint8Array): void {
	const decoder = decoding.createDecoder(frame);
	const messageType = decoding.readVarUint(decoder);
	if (messageType !== MESSAGE_SYNC) {
		// Non-sync message types (awareness = 1, auth = 2, queryAwareness = 3)
		// are intentionally ignored; this relay serves document sync only.
		return;
	}
	const reply = encoding.createEncoder();
	encoding.writeVarUint(reply, MESSAGE_SYNC);
	syncProtocol.readSyncMessage(decoder, reply, roomDoc, socket);
	if (encoding.length(reply) > 1) {
		deliverToClient(socket, encoding.toUint8Array(reply));
	}
}

interface RelayState {
	readonly docs: Map<string, Y.Doc>;
	readonly sockets: MemSocket[];
	readonly dials: MemDial[];
	readonly maxSockets: number;
	pendingRefusals: number;
}

function roomDoc(state: RelayState, room: string): Y.Doc {
	const existing = state.docs.get(room);
	if (existing !== undefined) return existing;
	const doc = new Y.Doc();
	doc.on('update', (update: Uint8Array, origin: unknown) => {
		const frame = encodeUpdateFrame(update);
		for (const peer of state.sockets) {
			if (peer.room === room && peer !== origin && peer.readyState === peer.OPEN) {
				deliverToClient(peer, frame);
			}
		}
	});
	state.docs.set(room, doc);
	return doc;
}

/**
 * Sets `socket` to `next` (closed unless given) and removes it from the
 * sockets updates fan out to.
 */
function forgetSocket(state: RelayState, socket: MemSocket, next: number = socket.CLOSED): void {
	socket.readyState = next;
	const index = state.sockets.indexOf(socket);
	if (index >= 0) state.sockets.splice(index, 1);
}

function openOrRefuse(state: RelayState, socket: MemSocket, admitted: boolean): void {
	if (socket.readyState !== socket.CONNECTING) return;
	if (!admitted) {
		socket.readyState = socket.CLOSED;
		socket.onclose?.({ code: 1013, reason: 'relay full' });
		return;
	}
	if (state.pendingRefusals > 0) {
		state.pendingRefusals -= 1;
		forgetSocket(state, socket);
		socket.onclose?.({ code: 1006, reason: 'refused' });
		return;
	}
	const doc = roomDoc(state, socket.room);
	socket.readyState = socket.OPEN;
	socket.onopen?.();
	if (socket.readyState === socket.OPEN) {
		deliverToClient(socket, encodeSyncStep1(doc));
	}
}

/** Socket bound to one relay; `createMemRelay` subclasses it with the WebSocket signature. */
class RelaySocket implements MemSocket {
	static readonly CONNECTING = 0 as const;
	static readonly OPEN = 1 as const;
	static readonly CLOSING = 2 as const;
	static readonly CLOSED = 3 as const;

	readonly CONNECTING = 0 as const;
	readonly OPEN = 1 as const;
	readonly CLOSING = 2 as const;
	readonly CLOSED = 3 as const;

	readonly url: string;
	readonly protocols: string[];
	readonly room: string;
	readyState = 0;
	binaryType = 'arraybuffer';
	onopen: (() => void) | null = null;
	onmessage: ((event: MemMessageEvent) => void) | null = null;
	onclose: ((event: MemCloseEvent) => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;
	readonly #relay: RelayState;

	constructor(relay: RelayState, url: string | URL, protocols?: string | string[]) {
		this.#relay = relay;
		this.url = typeof url === 'string' ? url : url.toString();
		this.protocols = normaliseProtocols(protocols);
		this.room = parseRoom(this.url);
		const admitted = relay.sockets.length < relay.maxSockets;
		if (admitted) relay.sockets.push(this);
		relay.dials.push({ url: this.url, protocols: [...this.protocols], socket: this });
		queueTask(() => {
			openOrRefuse(relay, this, admitted);
		});
	}

	send(data: ArrayBuffer | Uint8Array): void {
		if (this.readyState !== this.OPEN) return;
		const frame = toBytes(data);
		queueTask(() => {
			if (this.readyState !== this.OPEN) return;
			handleClientFrame(roomDoc(this.#relay, this.room), this, frame);
		});
	}

	/**
	 * Closes as a browser socket does (WHATWG WebSockets, `close()`): the socket
	 * is `CLOSING` and out of the fan-out at once, and one task later it is
	 * `CLOSED` and `onclose` fires once, with 1005 (no status) for an open
	 * socket. A socket still connecting never opens; it fires `onerror` and then
	 * `onclose` with 1006. A second call does nothing. Tests:
	 * `test/mem-relay.test.ts` "close()".
	 */
	close(): void {
		if (this.readyState >= this.CLOSING) return;
		const wasOpen = this.readyState === this.OPEN;
		forgetSocket(this.#relay, this, this.CLOSING);
		queueTask(() => {
			this.readyState = this.CLOSED;
			if (!wasOpen) this.onerror?.({ type: 'error' });
			this.onclose?.(wasOpen ? { code: 1005, reason: '' } : { code: 1006, reason: '' });
		});
	}
}

/**
 * In-memory stand-in for a `y-websocket` server. `test/provider-reconnect.test.ts`
 * uses it to drive real `WebsocketProvider` dials, drops and refusals under
 * Vitest fake timers with no network socket. Socket events fire one task later
 * (`queueTask`), as in a browser; P3, B1 and B2 there assert that
 * two peers converge across drops. It admits at most `maxSockets` open sockets
 * (`test/mem-relay.test.ts`).
 */
export function createMemRelay(options: MemRelayOptions = {}): MemRelay {
	const state: RelayState = {
		docs: new Map(),
		sockets: [],
		dials: [],
		maxSockets: Math.max(1, options.maxSockets ?? DEFAULT_MAX_SOCKETS),
		pendingRefusals: 0,
	};

	class Socket extends RelaySocket {
		constructor(url: string | URL, protocols?: string | string[]) {
			super(state, url, protocols);
		}
	}

	function drop(socket: MemSocket, code = 1006, reason = 'drop'): void {
		if (socket.readyState >= socket.CLOSING) return;
		forgetSocket(state, socket);
		socket.onclose?.({ code, reason });
	}

	function refuseNext(count: number): void {
		state.pendingRefusals = Math.max(0, count);
	}

	return {
		Socket,
		sockets: state.sockets,
		dials: state.dials,
		docFor: (room) => roomDoc(state, room),
		drop,
		refuseNext,
	};
}
