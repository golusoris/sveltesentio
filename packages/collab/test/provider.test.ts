import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { connectProvider } from '../src/provider.js';

class NoopSocket {
	readyState = 0;
	onopen: (() => void) | null = null;
	onmessage: ((ev: MessageEvent) => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: (() => void) | null = null;
	constructor(
		public url: string,
		public protocols?: string | string[],
	) {}
	send(): void {}
	close(): void {
		this.readyState = 3;
		this.onclose?.();
	}
}

describe('connectProvider', () => {
	it('constructs without connecting when connect=false and disconnect cleans up', () => {
		const doc = new Y.Doc();
		const { provider, disconnect } = connectProvider({
			url: 'ws://localhost:1234',
			room: 'test-room',
			doc,
			connect: false,
			WebSocketPolyfill: NoopSocket as unknown as typeof WebSocket,
			disableBc: true,
		});
		expect(provider.roomname).toBe('test-room');
		expect(provider.wsconnected).toBe(false);
		disconnect();
	});

	it('status callback receives normalised status values', () => {
		const doc = new Y.Doc();
		const received: string[] = [];
		const { provider, disconnect } = connectProvider({
			url: 'ws://localhost:1234',
			room: 'room',
			doc,
			connect: false,
			WebSocketPolyfill: NoopSocket as unknown as typeof WebSocket,
			disableBc: true,
			onStatusChange: (status) => received.push(status),
		});
		provider.emit('status', [{ status: 'connecting' }]);
		provider.emit('status', [{ status: 'connected' }]);
		provider.emit('status', [{ status: 'disconnected' }]);
		provider.emit('status', [{ status: 'something-else' }]);
		expect(received).toEqual([
			'connecting',
			'connected',
			'disconnected',
			'disconnected',
		]);
		disconnect();
	});

	it('sync callback is forwarded', () => {
		const doc = new Y.Doc();
		const synced: boolean[] = [];
		const { provider, disconnect } = connectProvider({
			url: 'ws://localhost:1234',
			room: 'room',
			doc,
			connect: false,
			WebSocketPolyfill: NoopSocket as unknown as typeof WebSocket,
			disableBc: true,
			onSync: (s) => synced.push(s),
		});
		provider.emit('sync', [true]);
		provider.emit('sync', [false]);
		expect(synced).toEqual([true, false]);
		disconnect();
	});
});
