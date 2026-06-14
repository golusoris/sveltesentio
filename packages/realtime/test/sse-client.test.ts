import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	SseClient,
	type EventSourceLike,
	type SseClientState,
} from '../src/sse-client.js';

type Listener = (event: unknown) => void;

class FakeEventSource implements EventSourceLike {
	static instances: FakeEventSource[] = [];
	closed = false;
	url: string;
	init: { withCredentials?: boolean } | undefined;
	private readonly listeners = new Map<string, Set<Listener>>();

	constructor(url: string, init?: { withCredentials?: boolean }) {
		this.url = url;
		this.init = init;
		FakeEventSource.instances.push(this);
	}

	addEventListener(type: string, handler: Listener): void {
		if (!this.listeners.has(type)) this.listeners.set(type, new Set());
		this.listeners.get(type)!.add(handler);
	}

	removeEventListener(type: string, handler: Listener): void {
		this.listeners.get(type)?.delete(handler);
	}

	close(): void {
		this.closed = true;
	}

	emit(type: string, payload?: unknown): void {
		for (const handler of this.listeners.get(type) ?? []) handler(payload);
	}
}

beforeEach(() => {
	vi.useFakeTimers();
	FakeEventSource.instances = [];
});
afterEach(() => {
	vi.useRealTimers();
});

describe('SseClient', () => {
	it('connects + transitions to open on the first event', () => {
		const states: SseClientState[] = [];
		const client = new SseClient({
			url: '/stream',
			eventSourceFactory: (url, init) => new FakeEventSource(url, init),
			onStateChange: (s) => states.push(s),
		});
		client.start();
		expect(states.at(-1)).toBe('connecting');
		expect(FakeEventSource.instances[0]?.url).toBe('/stream');
		FakeEventSource.instances[0]!.emit('open');
		expect(states.at(-1)).toBe('open');
	});

	it('delivers messages through onMessage with normalised shape', () => {
		const onMessage = vi.fn();
		const client = new SseClient({
			url: '/stream',
			eventSourceFactory: (url, init) => new FakeEventSource(url, init),
			onMessage,
		});
		client.start();
		FakeEventSource.instances[0]!.emit('message', {
			type: 'message',
			data: 'hello',
			lastEventId: '42',
		});
		expect(onMessage).toHaveBeenCalledWith({
			type: 'message',
			data: 'hello',
			lastEventId: '42',
		});
	});

	it('reconnects with exponential backoff after an error', () => {
		const errors: unknown[] = [];
		const client = new SseClient({
			url: '/stream',
			backoff: { minMs: 1000, maxMs: 10_000, jitter: 0, base: 2, random: () => 0.5 },
			eventSourceFactory: (url, init) => new FakeEventSource(url, init),
			onError: (e) => errors.push(e),
		});
		client.start();
		expect(FakeEventSource.instances.length).toBe(1);
		FakeEventSource.instances[0]!.emit('error', new Error('boom'));
		expect(errors.length).toBe(1);
		expect(FakeEventSource.instances[0]?.closed).toBe(true);

		vi.advanceTimersByTime(2000);
		expect(FakeEventSource.instances.length).toBe(2);
	});

	it('resets the attempt counter after a successful open', () => {
		const client = new SseClient({
			url: '/stream',
			backoff: { minMs: 500, maxMs: 10_000, jitter: 0, random: () => 0.5 },
			eventSourceFactory: (url, init) => new FakeEventSource(url, init),
		});
		client.start();
		FakeEventSource.instances[0]!.emit('error', new Error('one'));
		expect(client.currentAttempt).toBe(1);
		vi.advanceTimersByTime(1000);
		FakeEventSource.instances[1]!.emit('open');
		expect(client.currentAttempt).toBe(0);
	});

	it('close() stops all activity + transitions to closed', () => {
		const client = new SseClient({
			url: '/stream',
			backoff: { minMs: 500, maxMs: 10_000, jitter: 0, random: () => 0.5 },
			eventSourceFactory: (url, init) => new FakeEventSource(url, init),
		});
		client.start();
		FakeEventSource.instances[0]!.emit('error', new Error('err'));
		client.close();
		vi.advanceTimersByTime(5000);
		expect(FakeEventSource.instances.length).toBe(1);
		expect(client.currentState).toBe('closed');
	});

	it('throws when no factory + no global EventSource present', () => {
		expect(
			() => new SseClient({ url: '/s' }),
		).toThrow(/eventSourceFactory/);
	});
});
