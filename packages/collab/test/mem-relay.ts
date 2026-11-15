import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';

const MESSAGE_SYNC = 0;

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
	/** Sockets not yet closed; a socket leaves on `close()`, a drop or a refusal. */
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
	queueMicrotask(() => {
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

/** Marks `socket` closed and removes it from the sockets updates fan out to. */
function forgetSocket(state: RelayState, socket: MemSocket): void {
	socket.readyState = socket.CLOSED;
	const index = state.sockets.indexOf(socket);
	if (index >= 0) state.sockets.splice(index, 1);
}

function openOrRefuse(state: RelayState, socket: MemSocket): void {
	if (socket.readyState !== socket.CONNECTING) return;
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
		relay.sockets.push(this);
		relay.dials.push({ url: this.url, protocols: [...this.protocols], socket: this });
		queueMicrotask(() => {
			openOrRefuse(relay, this);
		});
	}

	send(data: ArrayBuffer | Uint8Array): void {
		if (this.readyState !== this.OPEN) return;
		const frame = toBytes(data);
		queueMicrotask(() => {
			if (this.readyState !== this.OPEN) return;
			handleClientFrame(roomDoc(this.#relay, this.room), this, frame);
		});
	}

	close(): void {
		forgetSocket(this.#relay, this);
	}
}

/**
 * In-memory stand-in for a `y-websocket` server. `test/provider-reconnect.test.ts`
 * uses it to drive real `WebsocketProvider` dials, drops and refusals under
 * Vitest fake timers with no network socket; P3, B1 and B2 there assert that
 * two peers converge across drops.
 */
export function createMemRelay(): MemRelay {
	const state: RelayState = { docs: new Map(), sockets: [], dials: [], pendingRefusals: 0 };

	class Socket extends RelaySocket {
		constructor(url: string | URL, protocols?: string | string[]) {
			super(state, url, protocols);
		}
	}

	function drop(socket: MemSocket, code = 1006, reason = 'drop'): void {
		if (socket.readyState === socket.CLOSED) return;
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
