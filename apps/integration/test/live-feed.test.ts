import { describe, it, expect, vi } from 'vitest';
import { liveFeedClient, reconnectDelay } from '../src/live-feed.js';
import type { EventSourceFactory, EventSourceLike } from '@sveltesentio/realtime';

/** A minimal in-memory EventSource the SseClient can drive without the DOM. */
function fakeEventSource(): {
	source: EventSourceLike;
	factory: EventSourceFactory;
	addListener: ReturnType<typeof vi.fn>;
	closeFn: ReturnType<typeof vi.fn>;
} {
	const addListener = vi.fn();
	const closeFn = vi.fn();
	const source: EventSourceLike = {
		addEventListener: (...args) => {
			addListener(...args);
		},
		removeEventListener: () => {},
		close: () => {
			closeFn();
		},
	};
	const factory: EventSourceFactory = () => source;
	return { source, factory, addListener, closeFn };
}

describe('realtime SseClient composition', () => {
	it('constructs an SSE client with an injected transport and connects', () => {
		const { factory, addListener, closeFn } = fakeEventSource();
		const client = liveFeedClient('https://app.example/live', factory);
		expect(client.currentState).toBe('idle');
		client.start();
		expect(client.currentState).toBe('connecting');
		// open/message/error listeners are wired on connect.
		expect(addListener).toHaveBeenCalledTimes(3);
		client.close();
		expect(client.currentState).toBe('closed');
		expect(closeFn).toHaveBeenCalledOnce();
	});
});

describe('realtime computeBackoff composition', () => {
	it('grows the reconnect delay across attempts within bounds', () => {
		const noJitter = { jitter: 0, random: () => 0.5 };
		const d0 = reconnectDelay(0, noJitter);
		const d1 = reconnectDelay(1, noJitter);
		const d2 = reconnectDelay(2, noJitter);
		expect(d0).toBe(1_000);
		expect(d1).toBe(2_000);
		expect(d2).toBe(4_000);
		expect(reconnectDelay(100, noJitter)).toBeLessThanOrEqual(30_000);
	});
});
