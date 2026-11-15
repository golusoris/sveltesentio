import { describe, it, expect } from 'vitest';
import { createMemRelay, type MemCloseEvent, type MemSocket } from './mem-relay.js';

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
		await Promise.resolve();
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
		await Promise.resolve();
		expect(opened).toBe(false);
		expect(extra.readyState).toBe(extra.CLOSED);
		expect(closes[2]).toEqual({ code: 1013, reason: 'relay full' });
		expect(relay.sockets).not.toContain(extra);
		expect(relay.dials).toHaveLength(3);
	});

	it('admits a new socket once one at the cap closes, and clamps the cap to one', async () => {
		const relay = createMemRelay({ maxSockets: 0 });
		const first = dial(relay, 1);
		await Promise.resolve();
		expect(first.sockets[0]?.readyState).toBe(1);
		first.sockets[0]?.close();
		const second = dial(relay, 1);
		await Promise.resolve();
		expect(second.sockets[0]?.readyState).toBe(1);
		expect(second.closes).toEqual([null]);
		expect(relay.sockets).toEqual(second.sockets);
	});
});
