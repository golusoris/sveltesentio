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

/**
 * Records `open`, `error` and `close <code> <reason>` of `socket` in firing
 * order, keeping the `onclose` set before.
 */
function trace(socket: MemSocket): string[] {
	const events: string[] = [];
	const record = socket.onclose;
	socket.onopen = () => {
		events.push('open');
	};
	socket.onerror = () => {
		events.push('error');
	};
	socket.onclose = (event) => {
		events.push(`close ${event.code} ${event.reason}`);
		record?.(event);
	};
	return events;
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

	it('fails a dial past maxSockets: error, then close 1006, never open', async () => {
		const relay = createMemRelay({ maxSockets: 2 });
		const { sockets, closes } = dial(relay, 3);
		const extra = sockets[2];
		if (extra === undefined) throw new Error('third socket missing');
		const events = trace(extra);
		await nextTask();
		expect(events).toEqual(['error', 'close 1006 relay full']);
		expect(extra.readyState).toBe(extra.CLOSED);
		expect(closes[2]).toEqual({ code: 1006, reason: 'relay full' });
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

describe('createMemRelay close()', () => {
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
});

describe('createMemRelay close() while connecting', () => {
	it('fails a socket closed while connecting: error, then close 1006, never open (boundary)', async () => {
		const relay = createMemRelay();
		const { sockets, closes } = dial(relay, 1);
		const socket = sockets[0];
		if (socket === undefined) throw new Error('socket missing');
		const events = trace(socket);
		expect(socket.readyState).toBe(socket.CONNECTING);
		socket.close();
		expect(socket.readyState).toBe(socket.CLOSING);
		await nextTask();
		await nextTask();
		expect(events).toEqual(['error', 'close 1006 ']);
		expect(closes).toEqual([{ code: 1006, reason: '' }]);
		expect(socket.readyState).toBe(socket.CLOSED);
		expect(relay.sockets).toEqual([]);
	});
});

/** One open socket with every event it fires recorded in order. */
async function openTraced() {
	const relay = createMemRelay();
	const { sockets } = dial(relay, 1);
	const socket = sockets[0];
	if (socket === undefined) throw new Error('socket missing');
	const events: string[] = [];
	await nextTask();
	socket.onerror = () => {
		events.push('error');
	};
	socket.onclose = (event) => {
		events.push(`close ${event.code} ${event.reason}`);
	};
	return { relay, socket, events };
}

describe('createMemRelay drop()', () => {
	it('fails a dropped socket one task later: error, then close 1006 (positive)', async () => {
		const { relay, socket, events } = await openTraced();
		relay.drop(socket);
		expect(socket.readyState).toBe(socket.CLOSING);
		expect(relay.sockets).not.toContain(socket);
		expect(events).toEqual([]);
		await nextTask();
		expect(events).toEqual(['error', 'close 1006 drop']);
		expect(socket.readyState).toBe(socket.CLOSED);
		expect(relay.handlerErrors).toEqual([]);
	});

	it('closes with a server close code and fires no error event (negative)', async () => {
		const { relay, socket, events } = await openTraced();
		relay.drop(socket, 4401, 'unauthorized');
		await nextTask();
		expect(events).toEqual(['close 4401 unauthorized']);
	});

	it('fires close once for a second drop (boundary)', async () => {
		const { relay, socket, events } = await openTraced();
		relay.drop(socket);
		relay.drop(socket, 1000, 'again');
		await nextTask();
		await nextTask();
		expect(events).toEqual(['error', 'close 1006 drop']);
	});

	it('still fires close when the error handler throws, keeping the thrown value (boundary)', async () => {
		const { relay, socket, events } = await openTraced();
		const failure = new Error('handler bug');
		socket.onerror = () => {
			events.push('error');
			throw failure;
		};
		relay.drop(socket);
		await nextTask();
		expect(events).toEqual(['error', 'close 1006 drop']);
		expect(relay.handlerErrors).toEqual([failure]);
	});
});

describe('createMemRelay refuseNext()', () => {
	it('fails a refused dial: error, then close 1006, never open, and opens the next (positive)', async () => {
		const relay = createMemRelay();
		relay.refuseNext(1);
		const [refused, admitted] = dial(relay, 2).sockets;
		if (refused === undefined || admitted === undefined) throw new Error('socket missing');
		const events = trace(refused);
		await nextTask();
		expect(events).toEqual(['error', 'close 1006 refused']);
		expect(refused.readyState).toBe(refused.CLOSED);
		expect(admitted.readyState).toBe(admitted.OPEN);
		expect(relay.sockets).toEqual([admitted]);
	});

	it('refuses nothing for a count below one (negative)', async () => {
		const relay = createMemRelay();
		relay.refuseNext(-1);
		const [socket] = dial(relay, 1).sockets;
		if (socket === undefined) throw new Error('socket missing');
		const events = trace(socket);
		await nextTask();
		expect(events).toEqual(['open']);
	});

	it('still fires the close of a refused dial when its error handler throws (boundary)', async () => {
		const relay = createMemRelay();
		relay.refuseNext(1);
		const [socket] = dial(relay, 1).sockets;
		if (socket === undefined) throw new Error('socket missing');
		const events = trace(socket);
		const failure = new Error('handler bug');
		socket.onerror = () => {
			events.push('error');
			throw failure;
		};
		await nextTask();
		expect(events).toEqual(['error', 'close 1006 refused']);
		expect(relay.handlerErrors).toEqual([failure]);
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
