import { describe, it, expect, vi } from 'vitest';
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

	it('keeps a caller subprotocol that a rotated token later resolves to', () => {
		const provider = new FakeProvider();
		provider.protocols = ['bearer.tok2'];
		const issued = ['tok1', 'tok2', 'tok3'];
		let n = 0;
		bindProviderAuth(provider, { token: () => issued[n++] ?? null, protocol: 'bearer' });
		expect(provider.protocols).toEqual(['bearer.tok2', 'bearer.tok1']);

		provider.emit('connection-close');
		expect(provider.protocols).toEqual(['bearer.tok2']);

		provider.emit('connection-close');
		expect(provider.protocols).toEqual(['bearer.tok2', 'bearer.tok3']);
	});

	it('does not duplicate a caller subprotocol equal to the auth entry', () => {
		const provider = new FakeProvider();
		provider.protocols = ['bearer.tok'];
		bindProviderAuth(provider, { token: 'tok', protocol: 'bearer' });
		expect(provider.protocols).toEqual(['bearer.tok']);

		provider.emit('connection-close');
		expect(provider.protocols).toEqual(['bearer.tok']);
	});

	it('updates params in place so a held reference stays live', () => {
		const provider = new FakeProvider();
		const held = provider.params;
		let n = 0;
		bindProviderAuth(provider, () => `t-${++n}`);
		provider.emit('connection-close');
		expect(provider.params).toBe(held);
		expect(held).toEqual({ token: 't-2' });
	});

	it('never mutates a frozen protocols array the caller supplied', () => {
		const provider = new FakeProvider();
		const callerProtocols = Object.freeze(['yjs-v1']);
		provider.protocols = callerProtocols as string[];
		bindProviderAuth(provider, { token: 'tok', protocol: 'bearer' });
		provider.emit('connection-close');
		expect(callerProtocols).toEqual(['yjs-v1']);
		expect(provider.protocols).toEqual(['yjs-v1', 'bearer.tok']);
	});

	it('ignores a stray third argument, so no caller-supplied owned state reaches the rebind', () => {
		const provider = new FakeProvider();
		provider.params = { room: 'r1' };
		const bindLoose = bindProviderAuth as (...args: unknown[]) => () => void;
		let n = 0;
		bindLoose(provider, () => `t-${++n}`, { params: null, protocols: null });
		expect(provider.params).toEqual({ room: 'r1', token: 't-1' });

		expect(() => provider.emit('connection-close')).not.toThrow();
		expect(provider.params).toEqual({ room: 'r1', token: 't-2' });
	});
	it('clears owned entries when the resolver throws, keeping caller entries', () => {
		const provider = new FakeProvider();
		provider.params = { room: 'r1' };
		provider.protocols = ['yjs-v1'];
		const failure = new Error('token service down');
		const onError = vi.fn();
		let calls = 0;
		bindProviderAuth(provider, {
			token: () => {
				calls += 1;
				if (calls > 1) throw failure;
				return 'tok1';
			},
			protocol: 'bearer',
			onError,
		});
		expect(provider.params).toEqual({ room: 'r1', token: 'tok1' });
		expect(provider.protocols).toEqual(['yjs-v1', 'bearer.tok1']);

		expect(() => provider.emit('connection-close')).not.toThrow();
		expect(onError).toHaveBeenCalledTimes(1);
		expect(onError).toHaveBeenCalledWith(failure);
		expect(provider.params).toEqual({ room: 'r1' });
		expect(provider.protocols).toEqual(['yjs-v1']);
	});

	it('reports a resolver failure through console.error when no onError is given', () => {
		const provider = new FakeProvider();
		const failure = new Error('token expired');
		let calls = 0;
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			bindProviderAuth(provider, () => {
				calls += 1;
				if (calls > 1) throw failure;
				return 'tok1';
			});
			provider.emit('connection-close');
			expect(errorSpy).toHaveBeenCalledTimes(1);
			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining('auth token resolver threw'),
				failure,
			);
			expect(provider.params).toEqual({});
		} finally {
			errorSpy.mockRestore();
		}
	});

	it('lets a resolver failure at bind time reach the caller and binds nothing', () => {
		const provider = new FakeProvider();
		provider.params = { room: 'r1' };
		const failure = new Error('token service down');
		const onError = vi.fn();
		const bind = (): unknown =>
			bindProviderAuth(provider, {
				token: () => {
					throw failure;
				},
				onError,
			});
		expect(bind).toThrow(failure);
		expect(onError).not.toHaveBeenCalled();
		expect(provider.params).toEqual({ room: 'r1' });
		expect(provider.listenerCount('connection-close')).toBe(0);
	});

	it('restores the caller value of a param the token shadowed once the token is revoked', () => {
		const provider = new FakeProvider();
		provider.params = { token: 'guest', v: '2' };
		const issued = ['tok1', 'tok2'];
		let n = 0;
		bindProviderAuth(provider, () => issued[n++] ?? null);
		expect(provider.params).toEqual({ token: 'tok1', v: '2' });

		provider.emit('connection-close');
		expect(provider.params).toEqual({ token: 'tok2', v: '2' });

		provider.emit('connection-close');
		expect(provider.params).toEqual({ token: 'guest', v: '2' });
	});

	it('keeps the position of a caller copy of an owned subprotocol', () => {
		const provider = new FakeProvider();
		provider.protocols = ['yjs-v1'];
		const issued = ['tok1', 'tok2'];
		let n = 0;
		bindProviderAuth(provider, { token: () => issued[n++] ?? null, protocol: 'bearer' });
		expect(provider.protocols).toEqual(['yjs-v1', 'bearer.tok1']);

		provider.protocols.push('x', 'bearer.tok1');
		provider.emit('connection-close');
		expect(provider.protocols).toEqual(['yjs-v1', 'x', 'bearer.tok1', 'bearer.tok2']);
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

	it('resolves a rotating token for every dial, not only at construction', () => {
		NoopSocket.last = null;
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
		// Construction resolves once to fill provider.params; nothing dials yet.
		expect(provider.params.token).toBe('tok-1');
		expect(NoopSocket.last).toBeNull();

		provider.connect();
		expect(NoopSocket.last!.url).toContain('token=tok-2');

		provider.disconnect();
		provider.connect();
		expect(NoopSocket.last!.url).toContain('token=tok-3');
		expect(n).toBe(3);
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

	it('resolves no further token after disconnect', () => {
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
		expect(provider.params.token).toBe('tok-1');
		disconnect();
		// No listener is left behind, so a stray close event must not rotate.
		provider.emit('connection-close', [null, provider]);
		expect(provider.params.token).toBe('tok-1');
		expect(n).toBe(1);
	});
});
