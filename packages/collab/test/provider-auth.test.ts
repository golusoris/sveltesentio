import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
	type AuthBinding,
	connectProvider,
	resolveAuthParams,
	bindProviderAuth,
} from '../src/provider.js';

/** No-op socket so no real connection is opened; captures the connect URL. */
class NoopSocket {
	static last: NoopSocket | null = null;
	readyState = 0;
	onopen: (() => void) | null = null;
	onmessage: ((ev: MessageEvent) => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: (() => void) | null = null;
	constructor(
		public url: string,
		public protocols?: string | string[],
	) {
		NoopSocket.last = this;
	}
	send(): void {}
	close(): void {
		this.readyState = 3;
		this.onclose?.();
	}
}

/** Minimal stand-in for the `WebsocketProvider` surface `bindProviderAuth` touches. */
class FakeProvider {
	params: Record<string, string> = {};
	protocols: string[] = [];
	private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();
	on(event: string, cb: (...args: unknown[]) => void): void {
		let set = this.listeners.get(event);
		if (!set) {
			set = new Set();
			this.listeners.set(event, set);
		}
		set.add(cb);
	}
	off(event: string, cb: (...args: unknown[]) => void): void {
		this.listeners.get(event)?.delete(cb);
	}
	emit(event: string): void {
		for (const cb of this.listeners.get(event) ?? []) cb();
	}
	listenerCount(event: string): number {
		return this.listeners.get(event)?.size ?? 0;
	}
}

describe('resolveAuthParams', () => {
	it('maps a bare token string to the default `token` query param', () => {
		expect(resolveAuthParams('secret-123')).toEqual({
			params: { token: 'secret-123' },
			protocols: [],
		});
	});

	it('calls a token resolver function each time (rotation)', () => {
		let n = 0;
		const auth = (): string => `t-${++n}`;
		expect(resolveAuthParams(auth).params).toEqual({ token: 't-1' });
		expect(resolveAuthParams(auth).params).toEqual({ token: 't-2' });
	});

	it('honours a custom param key', () => {
		const auth: AuthBinding = { token: 'abc', param: 'access_token' };
		expect(resolveAuthParams(auth)).toEqual({
			params: { access_token: 'abc' },
			protocols: [],
		});
	});

	it('skips the query param when param is null', () => {
		const auth: AuthBinding = { token: 'abc', param: null, protocol: 'bearer' };
		expect(resolveAuthParams(auth)).toEqual({
			params: {},
			protocols: ['bearer.abc'],
		});
	});

	it('emits a subprotocol entry alongside the query param when protocol is set', () => {
		const auth: AuthBinding = { token: 'abc', protocol: 'bearer' };
		expect(resolveAuthParams(auth)).toEqual({
			params: { token: 'abc' },
			protocols: ['bearer.abc'],
		});
	});

	it('attaches nothing for an empty / nullish token', () => {
		expect(resolveAuthParams('')).toEqual({ params: {}, protocols: [] });
		expect(resolveAuthParams(() => null)).toEqual({ params: {}, protocols: [] });
		expect(resolveAuthParams(() => undefined)).toEqual({
			params: {},
			protocols: [],
		});
	});
});

describe('bindProviderAuth', () => {
	it('applies the resolved token to the live provider params on bind', () => {
		const provider = new FakeProvider();
		bindProviderAuth(provider, 'tok');
		expect(provider.params).toEqual({ token: 'tok' });
		expect(provider.listenerCount('connection-close')).toBe(1);
	});

	it('re-resolves a rotating token on reconnect (connection-close)', () => {
		const provider = new FakeProvider();
		let n = 0;
		bindProviderAuth(provider, () => `t-${++n}`);
		expect(provider.params).toEqual({ token: 't-1' });

		provider.emit('connection-close');
		expect(provider.params).toEqual({ token: 't-2' });

		provider.emit('connection-close');
		expect(provider.params).toEqual({ token: 't-3' });
	});

	it('preserves non-auth params already on the provider', () => {
		const provider = new FakeProvider();
		provider.params = { room: 'r1' };
		bindProviderAuth(provider, 'tok');
		expect(provider.params).toEqual({ room: 'r1', token: 'tok' });
	});

	it('sets the subprotocol entry when protocol is configured', () => {
		const provider = new FakeProvider();
		bindProviderAuth(provider, { token: 'tok', protocol: 'bearer' });
		expect(provider.protocols).toEqual(['bearer.tok']);
	});

	it('unbind removes the reconnect listener and stops rotating', () => {
		const provider = new FakeProvider();
		let n = 0;
		const unbind = bindProviderAuth(provider, () => `t-${++n}`);
		expect(provider.params).toEqual({ token: 't-1' });

		unbind();
		expect(provider.listenerCount('connection-close')).toBe(0);

		provider.emit('connection-close');
		expect(provider.params).toEqual({ token: 't-1' });
	});
});

describe('connectProvider — auth binding', () => {
	it('attaches a static token to the connect URL as a query param', () => {
		NoopSocket.last = null;
		const doc = new Y.Doc();
		const { provider, disconnect } = connectProvider({
			url: 'ws://localhost:1234',
			room: 'room',
			doc,
			connect: true,
			disableBc: true,
			WebSocketPolyfill: NoopSocket as unknown as typeof WebSocket,
			auth: 'sekret',
		});
		expect(provider.params).toMatchObject({ token: 'sekret' });
		expect(NoopSocket.last).not.toBeNull();
		expect(NoopSocket.last!.url).toContain('token=sekret');
		disconnect();
	});

	it('merges auth token with caller-supplied params', () => {
		const doc = new Y.Doc();
		const { provider, disconnect } = connectProvider({
			url: 'ws://localhost:1234',
			room: 'room',
			doc,
			connect: false,
			disableBc: true,
			WebSocketPolyfill: NoopSocket as unknown as typeof WebSocket,
			params: { v: '2' },
			auth: { token: 'abc', param: 'access_token' },
		});
		expect(provider.params).toMatchObject({ v: '2', access_token: 'abc' });
		disconnect();
	});

	it('re-resolves a rotating token across a reconnect cycle', () => {
		const doc = new Y.Doc();
		let n = 0;
		const { provider, disconnect } = connectProvider({
			url: 'ws://localhost:1234',
			room: 'room',
			doc,
			connect: false,
			disableBc: true,
			WebSocketPolyfill: NoopSocket as unknown as typeof WebSocket,
			auth: () => `tok-${++n}`,
		});
		// Construction resolves the token at least once.
		expect(provider.params.token).toMatch(/^tok-\d+$/);
		const before = provider.params.token;

		provider.emit('connection-close', [null, provider]);
		// A reconnect re-resolves to a fresh token (monotonic counter advanced).
		expect(provider.params.token).not.toBe(before);
		expect(provider.params.token).toMatch(/^tok-\d+$/);
		disconnect();
	});

	it('passes the auth subprotocol through to the socket constructor', () => {
		NoopSocket.last = null;
		const doc = new Y.Doc();
		const { disconnect } = connectProvider({
			url: 'ws://localhost:1234',
			room: 'room',
			doc,
			connect: true,
			disableBc: true,
			WebSocketPolyfill: NoopSocket as unknown as typeof WebSocket,
			auth: { token: 'tok', param: null, protocol: 'bearer' },
		});
		const protocols = NoopSocket.last!.protocols;
		const list = Array.isArray(protocols) ? protocols : protocols ? [protocols] : [];
		expect(list).toContain('bearer.tok');
		disconnect();
	});

	it('disconnect unbinds the auth reconnect listener', () => {
		const doc = new Y.Doc();
		let n = 0;
		const { provider, disconnect } = connectProvider({
			url: 'ws://localhost:1234',
			room: 'room',
			doc,
			connect: false,
			disableBc: true,
			WebSocketPolyfill: NoopSocket as unknown as typeof WebSocket,
			auth: () => `tok-${++n}`,
		});
		expect(provider.params.token).toMatch(/^tok-\d+$/);
		disconnect();
		const frozen = provider.params.token;
		// After disconnect the rebind listener is gone; emitting must not rotate.
		provider.emit('connection-close', [null, provider]);
		expect(provider.params.token).toBe(frozen);
	});
});
