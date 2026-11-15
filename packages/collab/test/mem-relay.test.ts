import { describe, it, expect } from 'vitest';
import { createMemRelay, nextTask, type MemCloseEvent, type MemSocket } from './mem-relay.js';

const URL_BASE = 'ws://relay.test';

/** Dials `count` sockets and records each close event by dial index. */
function dial(relay: ReturnType<typeof createMemRelay>, count: number) {
	const closes: (MemCloseEvent | null)[] = [];
	const sockets: MemSocket[] = [];
	for (let index = 0; index < count; index += 1) {
		const socket = new relay.Socket(`${URL_BASE}/room-cap`);
		closes.push(null);
		socket.onclose = (event) => {
			closes[index] = event;
		};
		sockets.push(socket);
	}
	return { sockets, closes };
}

describe('createMemRelay socket cap', () => {
	it('opens every socket up to maxSockets', async () => {
		const relay = createMemRelay({ maxSockets: 2 });
		const { sockets, closes } = dial(relay, 2);
		await nextTask();
		expect(sockets.map((socket) => socket.readyState)).toEqual([1, 1]);
		expect(closes).toEqual([null, null]);
		expect(relay.sockets).toHaveLength(2);
	});

	it('closes a dial past maxSockets with 1013 and never opens it', async () => {
		const relay = createMemRelay({ maxSockets: 2 });
		const { sockets, closes } = dial(relay, 3);
		let opened = false;
		const extra = sockets[2];
		if (extra === undefined) throw new Error('third socket missing');
		extra.onopen = () => {
			opened = true;
		};
		await nextTask();
		expect(opened).toBe(false);
		expect(extra.readyState).toBe(extra.CLOSED);
		expect(closes[2]).toEqual({ code: 1013, reason: 'relay full' });
		expect(relay.sockets).not.toContain(extra);
		expect(relay.dials).toHaveLength(3);
	});

	it('admits a new socket once one at the cap closes, and clamps the cap to one', async () => {
		const relay = createMemRelay({ maxSockets: 0 });
		const first = dial(relay, 1);
		await nextTask();
		expect(first.sockets[0]?.readyState).toBe(1);
		first.sockets[0]?.close();
		const second = dial(relay, 1);
		await nextTask();
		expect(second.sockets[0]?.readyState).toBe(1);
		expect(second.closes).toEqual([null]);
		expect(relay.sockets).toEqual(second.sockets);
	});
});

describe('createMemRelay close()', () => {
	/** One open socket with its close and error events recorded. */
	async function openSocket() {
		const relay = createMemRelay();
		const { sockets, closes } = dial(relay, 1);
		const socket = sockets[0];
		if (socket === undefined) throw new Error('socket missing');
		const errors: unknown[] = [];
		socket.onerror = (event) => {
			errors.push(event);
		};
		await nextTask();
		return { relay, socket, closes, errors };
	}

	it('closes an open socket one task later with 1005 and fires onclose once (positive)', async () => {
		const { relay, socket, closes, errors } = await openSocket();
		expect(socket.readyState).toBe(socket.OPEN);
		socket.close();
		expect(socket.readyState).toBe(socket.CLOSING);
		expect(relay.sockets).not.toContain(socket);
		expect(closes).toEqual([null]);
		await nextTask();
		expect(socket.readyState).toBe(socket.CLOSED);
		expect(closes).toEqual([{ code: 1005, reason: '' }]);
		expect(errors).toEqual([]);
	});

	it('ignores a second close() and a drop after close() (negative)', async () => {
		const { relay, socket, closes } = await openSocket();
		let fired = 0;
		socket.onclose = () => {
			fired += 1;
		};
		socket.close();
		socket.close();
		relay.drop(socket);
		await nextTask();
		await nextTask();
		socket.close();
		relay.drop(socket);
		await nextTask();
		expect(fired).toBe(1);
		expect(closes).toEqual([null]);
		expect(socket.readyState).toBe(socket.CLOSED);
	});

	it('fails a socket closed while connecting: error, then close 1006, never open (boundary)', async () => {
		const relay = createMemRelay();
		const { sockets, closes } = dial(relay, 1);
		const socket = sockets[0];
		if (socket === undefined) throw new Error('socket missing');
		const events: string[] = [];
		socket.onopen = () => {
			events.push('open');
		};
		socket.onerror = () => {
			events.push('error');
		};
		const record = socket.onclose;
		socket.onclose = (event) => {
			events.push('close');
			record?.(event);
		};
		expect(socket.readyState).toBe(socket.CONNECTING);
		socket.close();
		expect(socket.readyState).toBe(socket.CLOSING);
		await nextTask();
		await nextTask();
		expect(events).toEqual(['error', 'close']);
		expect(closes).toEqual([{ code: 1006, reason: '' }]);
		expect(socket.readyState).toBe(socket.CLOSED);
		expect(relay.sockets).toEqual([]);
	});
});

describe('createMemRelay task timing', () => {
	it('fires open one task after the dial, after pending microtasks', async () => {
		const relay = createMemRelay();
		const { sockets } = dial(relay, 1);
		const socket = sockets[0];
		if (socket === undefined) throw new Error('socket missing');
		const order: string[] = [];
		socket.onopen = () => {
			order.push('open');
		};
		queueMicrotask(() => {
			order.push('microtask');
		});
		await Promise.resolve();
		expect(order).toEqual(['microtask']);
		expect(socket.readyState).toBe(socket.CONNECTING);
		await nextTask();
		expect(order).toEqual(['microtask', 'open']);
		expect(socket.readyState).toBe(socket.OPEN);
	});

	it('delivers a frame and a close one task later, never inside the microtask turn', async () => {
		const relay = createMemRelay();
		const { sockets, closes } = dial(relay, 1);
		const socket = sockets[0];
		if (socket === undefined) throw new Error('socket missing');
		const messages: number[] = [];
		socket.onmessage = (event) => {
			messages.push(event.data.byteLength);
		};
		await nextTask();
		expect(messages).toEqual([]);
		await nextTask();
		expect(messages).toHaveLength(1);
		socket.close();
		await Promise.resolve();
		await Promise.resolve();
		expect(closes).toEqual([null]);
		await nextTask();
		expect(closes).toEqual([{ code: 1005, reason: '' }]);
	});
});
