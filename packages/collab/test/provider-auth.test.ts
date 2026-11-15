import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import {
	type AuthBindableProvider,
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

type SocketConstructor = NonNullable<AuthBindableProvider['_WS']>;

interface Dial {
	readonly url: string;
	readonly protocols: readonly string[];
}

function protocolList(protocols: string | string[] | undefined): string[] {
	if (protocols === undefined) return [];
	return typeof protocols === 'string' ? [protocols] : [...protocols];
}

/**
 * Minimal stand-in for the `WebsocketProvider` surface `bindProviderAuth`
 * touches. `dial()` builds a socket the way y-websocket's `setupWS` does, and
 * `dials` records every socket the original constructor built.
 */
class FakeProvider implements AuthBindableProvider {
	params: Record<string, string> = {};
	protocols: string[] = [];
	readonly dials: Dial[] = [];
	readonly original: SocketConstructor;
	_WS: SocketConstructor;
	constructor() {
		const dials = this.dials;
		class RecordingSocket extends NoopSocket {
			constructor(url: string, protocols?: string | string[]) {
				super(url, protocols);
				dials.push({ url, protocols: protocolList(protocols) });
			}
		}
		this.original = RecordingSocket as unknown as SocketConstructor;
		this._WS = this.original;
	}
	on(): void {}
	off(): void {}
	/** The URL y-websocket dials: `encodeQueryParams` from lib0, no `?` when empty. */
	url(): string {
		const query = Object.entries(this.params)
			.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
			.join('&');
		return query === '' ? 'ws://x/room' : `ws://x/room?${query}`;
	}
	dial(): WebSocket {
		return this.build(this.url(), this.protocols);
	}
	build(url: string, protocols?: string | string[]): WebSocket {
		return new this._WS(url, protocols);
	}
	urls(): string[] {
		return this.dials.map((dial) => dial.url);
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
	it('puts the token in the dial URL and writes nothing to the provider', () => {
		const provider = new FakeProvider();
		bindProviderAuth(provider, 'tok');
		provider.dial();
		expect(provider.dials).toEqual([{ url: 'ws://x/room?token=tok', protocols: [] }]);
		expect(provider.params).toEqual({});
		expect(provider.protocols).toEqual([]);
	});

	it('resolves a rotating token once per socket, the first one included', () => {
		const provider = new FakeProvider();
		let n = 0;
		bindProviderAuth(provider, () => `t-${++n}`);
		expect(n).toBe(0);
		provider.dial();
		provider.dial();
		provider.dial();
		expect(provider.urls()).toEqual([
			'ws://x/room?token=t-1',
			'ws://x/room?token=t-2',
			'ws://x/room?token=t-3',
		]);
		expect(n).toBe(3);
	});

	it('sends the token current at the first dial, not the one at bind time', () => {
		const provider = new FakeProvider();
		let current = 'stale';
		bindProviderAuth(provider, () => current);
		current = 'fresh';
		provider.dial();
		expect(provider.urls()).toEqual(['ws://x/room?token=fresh']);
	});

	it('keeps caller params and replaces a caller value under the auth key only while a token resolves', () => {
		const provider = new FakeProvider();
		provider.params = { token: 'guest', v: '2' };
		const issued = ['tok1', 'tok2'];
		let n = 0;
		bindProviderAuth(provider, () => issued[n++] ?? null);
		provider.dial();
		provider.dial();
		provider.dial();
		expect(provider.urls()).toEqual([
			'ws://x/room?v=2&token=tok1',
			'ws://x/room?v=2&token=tok2',
			'ws://x/room?token=guest&v=2',
		]);
		expect(provider.params).toEqual({ token: 'guest', v: '2' });
	});

	it('sends a caller update under the auth key once the token is revoked', () => {
		const provider = new FakeProvider();
		provider.params = { token: 'guest' };
		let current: string | null = 'tok1';
		bindProviderAuth(provider, () => current);
		provider.dial();
		provider.params.token = 'guest2';
		current = null;
		provider.dial();
		expect(provider.urls()).toEqual(['ws://x/room?token=tok1', 'ws://x/room?token=guest2']);
	});

	it('matches query keys whole and percent-encoded', () => {
		const provider = new FakeProvider();
		provider.params = { 'access token': 'caller', tokenx: '1' };
		bindProviderAuth(provider, { token: 'a b&c', param: 'access token' });
		provider.dial();
		expect(provider.urls()).toEqual(['ws://x/room?tokenx=1&access%20token=a%20b%26c']);
	});

	it('keeps a query pair without a value and drops an empty one', () => {
		const provider = new FakeProvider();
		bindProviderAuth(provider, 'tok');
		provider.build('ws://x/room?flag&&token=old', []);
		expect(provider.urls()).toEqual(['ws://x/room?flag&token=tok']);
	});

	it('reads the query after the last ?, the one y-websocket writes before its params', () => {
		const provider = new FakeProvider();
		bindProviderAuth(provider, 'tok');
		provider.build('ws://x/a?b?token=old', []);
		expect(provider.urls()).toEqual(['ws://x/a?b?token=tok']);
	});

	it('appends the auth subprotocol to a copy and never mutates the caller array', () => {
		const provider = new FakeProvider();
		const callerProtocols = Object.freeze(['yjs-v1']);
		provider.protocols = callerProtocols as string[];
		bindProviderAuth(provider, { token: 'tok', protocol: 'bearer' });
		provider.dial();
		expect(provider.dials[0]?.protocols).toEqual(['yjs-v1', 'bearer.tok']);
		expect(callerProtocols).toEqual(['yjs-v1']);
		expect(provider.protocols).toBe(callerProtocols);
	});

	it('sends a caller subprotocol equal to an auth entry once, also when added mid-session', () => {
		const provider = new FakeProvider();
		provider.protocols = ['yjs-v1'];
		const issued = ['tok1', 'tok2'];
		let n = 0;
		bindProviderAuth(provider, { token: () => issued[n++] ?? null, protocol: 'bearer' });
		provider.dial();
		provider.protocols.push('bearer.tok1');
		provider.dial();
		provider.dial();
		expect(provider.dials.map((dial) => dial.protocols)).toEqual([
			['yjs-v1', 'bearer.tok1'],
			['yjs-v1', 'bearer.tok1', 'bearer.tok2'],
			['yjs-v1', 'bearer.tok1'],
		]);
	});

	it('takes a single subprotocol string or none', () => {
		const provider = new FakeProvider();
		bindProviderAuth(provider, { token: 'tok', param: null, protocol: 'bearer' });
		provider.build('ws://x/room', 'bearer.tok');
		provider.build('ws://x/room', 'yjs-v1');
		provider.build('ws://x/room');
		expect(provider.dials).toEqual([
			{ url: 'ws://x/room', protocols: ['bearer.tok'] },
			{ url: 'ws://x/room', protocols: ['yjs-v1', 'bearer.tok'] },
			{ url: 'ws://x/room', protocols: ['bearer.tok'] },
		]);
	});

	it('refuses the dial without building a socket when the resolver throws', async () => {
		const provider = new FakeProvider();
		const failure = new Error('token service down');
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			let calls = 0;
			bindProviderAuth(provider, () => {
				calls += 1;
				if (calls === 1) throw failure;
				return `tok${calls}`;
			});
			const socket = provider.dial();
			expect(provider.dials).toEqual([]);
			expect(socket.url).toBe('ws://x/room');
			expect(socket.readyState).toBe(socket.CONNECTING);
			const seen: string[] = [];
			let errorEvent: Event | undefined;
			let closeEvent: CloseEvent | undefined;
			socket.onerror = (event) => {
				seen.push('error');
				errorEvent = event;
			};
			socket.onclose = (event) => {
				seen.push('close');
				closeEvent = event;
			};
			expect(seen).toEqual([]);

			await Promise.resolve();
			expect(seen).toEqual(['error', 'close']);
			expect(errorEvent).toHaveProperty('error', failure);
			expect(closeEvent?.code).toBe(1006);
			expect(closeEvent?.wasClean).toBe(false);
			expect(socket.readyState).toBe(socket.CLOSED);
			expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('dial refused'), 'Error');

			provider.dial();
			expect(provider.urls()).toEqual(['ws://x/room?token=tok2']);
		} finally {
			errorSpy.mockRestore();
		}
	});

	it('still fires the close of a refused dial when its error handler throws', async () => {
		const provider = new FakeProvider();
		const handlerFailure = new Error('handler bug');
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			bindProviderAuth(provider, () => {
				throw new Error('token service down');
			});
			const socket = provider.dial();
			let closes = 0;
			socket.onerror = () => {
				throw handlerFailure;
			};
			socket.onclose = () => {
				closes += 1;
			};
			await Promise.resolve();
			expect(closes).toBe(1);
			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining('socket event handler threw'),
				'Error',
			);
		} finally {
			errorSpy.mockRestore();
		}
	});

	it('fires only the close for a refused dial closed before the refusal runs', async () => {
		const provider = new FakeProvider();
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			bindProviderAuth(provider, () => {
				throw new Error('token service down');
			});
			// y-websocket 2.0.0 shape: onclose clears provider.ws, and connect() needs it null.
			let ws: WebSocket | null = provider.dial();
			const socket = ws;
			const onerror = vi.fn();
			const closes: CloseEvent[] = [];
			const listener = vi.fn();
			socket.onerror = onerror;
			socket.onclose = (event) => {
				closes.push(event);
				ws = null;
			};
			socket.addEventListener('close', listener);
			socket.close();
			expect(socket.readyState).toBe(socket.CLOSING);
			await Promise.resolve();
			expect(onerror).not.toHaveBeenCalled();
			expect(closes).toHaveLength(1);
			expect(closes[0]).toMatchObject({ code: 1006, wasClean: false });
			expect(listener).toHaveBeenCalledTimes(1);
			expect(ws).toBeNull();
			expect(socket.readyState).toBe(socket.CLOSED);
			socket.close();
			await Promise.resolve();
			expect(closes).toHaveLength(1);
			expect(socket.readyState).toBe(socket.CLOSED);
		} finally {
			errorSpy.mockRestore();
		}
	});

	it('fires the events of a refused dial to its listeners', async () => {
		const provider = new FakeProvider();
		const failure = new Error('token service down');
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			bindProviderAuth(provider, () => {
				throw failure;
			});
			const socket = provider.dial();
			const seen: string[] = [];
			const errors: unknown[] = [];
			const closeCodes: number[] = [];
			socket.onerror = () => seen.push('onerror');
			socket.addEventListener('error', (event) => {
				seen.push('error listener');
				errors.push((event as Event & { readonly error: unknown }).error);
			});
			socket.addEventListener('close', (event) => {
				seen.push('close listener');
				closeCodes.push(event.code);
			});
			socket.send('frame');
			expect(socket).toMatchObject({
				binaryType: 'blob',
				bufferedAmount: 0,
				extensions: '',
				protocol: '',
			});
			await Promise.resolve();
			expect(seen).toEqual(['onerror', 'error listener', 'close listener']);
			expect(errors).toEqual([failure]);
			expect(closeCodes).toEqual([1006]);
		} finally {
			errorSpy.mockRestore();
		}
	});

	it('fires nothing to a listener removed before the refusal runs', async () => {
		const provider = new FakeProvider();
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			bindProviderAuth(provider, () => {
				throw new Error('token service down');
			});
			const socket = provider.dial();
			const listener = vi.fn();
			socket.addEventListener('close', listener);
			socket.removeEventListener('close', listener);
			await Promise.resolve();
			expect(listener).not.toHaveBeenCalled();
		} finally {
			errorSpy.mockRestore();
		}
	});

	it('fires nothing to a listener added after the refusal ran', async () => {
		const provider = new FakeProvider();
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			bindProviderAuth(provider, () => {
				throw new Error('token service down');
			});
			const socket = provider.dial();
			await Promise.resolve();
			const listener = vi.fn();
			socket.addEventListener('close', listener);
			socket.addEventListener('error', listener);
			await Promise.resolve();
			expect(listener).not.toHaveBeenCalled();
			expect(socket.readyState).toBe(socket.CLOSED);
		} finally {
			errorSpy.mockRestore();
		}
	});

	it('logs only the name of a resolver error', async () => {
		const provider = new FakeProvider();
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		class TokenError extends Error {
			override name = 'TokenError';
		}
		try {
			bindProviderAuth(provider, () => {
				throw new TokenError('token tok-secret was rejected');
			});
			const socket = provider.dial();
			await Promise.resolve();
			expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('dial refused'), 'TokenError');
			expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('tok-secret');
			expect(socket.readyState).toBe(socket.CLOSED);
		} finally {
			errorSpy.mockRestore();
		}
	});

	it('logs only the type of a thrown value that is not an error', async () => {
		const provider = new FakeProvider();
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			bindProviderAuth(provider, () => {
				// eslint-disable-next-line @typescript-eslint/only-throw-error -- a resolver may throw a non-Error value; its log line must not carry it
				throw 'tok-secret';
			});
			const socket = provider.dial();
			socket.onerror = () => {
				// eslint-disable-next-line @typescript-eslint/only-throw-error -- a handler may throw a non-Error value; its log line must not carry it
				throw { token: 'tok-secret' };
			};
			await Promise.resolve();
			expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('dial refused'), 'string');
			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining('socket event handler threw'),
				'object',
			);
			expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('tok-secret');
		} finally {
			errorSpy.mockRestore();
		}
	});

	it('keeps the binding of each provider apart', () => {
		const first = new FakeProvider();
		const second = new FakeProvider();
		bindProviderAuth(first, { token: 'tokA', param: 'a' });
		const unbindSecond = bindProviderAuth(second, { token: 'tokB', param: 'b' });
		first.dial();
		second.dial();
		unbindSecond();
		first.dial();
		expect(first.urls()).toEqual(['ws://x/room?a=tokA', 'ws://x/room?a=tokA']);
		expect(second.urls()).toEqual(['ws://x/room?b=tokB']);
	});

	it('lets only the latest binding inject', () => {
		const provider = new FakeProvider();
		const unbindA = bindProviderAuth(provider, { token: 'tokA', param: 'a' });
		const unbindB = bindProviderAuth(provider, { token: 'tokB', param: 'b' });
		provider.dial();
		unbindB();
		provider.dial();
		unbindA();
		provider.dial();
		expect(provider.urls()).toEqual(['ws://x/room?b=tokB', 'ws://x/room', 'ws://x/room']);
		expect(provider._WS).toBe(provider.original);
	});

	it('unbind puts back the socket constructor it wrapped, once', () => {
		const provider = new FakeProvider();
		const unbind = bindProviderAuth(provider, 'tok');
		expect(provider._WS).not.toBe(provider.original);
		unbind();
		expect(provider._WS).toBe(provider.original);
		unbind();
		expect(provider._WS).toBe(provider.original);
		provider.dial();
		expect(provider.urls()).toEqual(['ws://x/room']);
	});

	it('unbinding a replaced binding leaves the latest one injecting', () => {
		const provider = new FakeProvider();
		const unbindA = bindProviderAuth(provider, { token: 'tokA', param: 'a' });
		bindProviderAuth(provider, { token: 'tokB', param: 'b' });
		const wrappedByB = provider._WS;
		unbindA();
		expect(provider._WS).toBe(wrappedByB);
		provider.dial();
		expect(provider.urls()).toEqual(['ws://x/room?b=tokB']);
	});

	it('unbind leaves a constructor wrapped since in place and stops injecting', () => {
		const provider = new FakeProvider();
		const unbind = bindProviderAuth(provider, 'tok');
		const Wrapped = class extends provider._WS {};
		provider._WS = Wrapped;
		unbind();
		expect(provider._WS).toBe(Wrapped);
		provider.dial();
		expect(provider.urls()).toEqual(['ws://x/room']);
	});

	it('warns and binds nothing on a provider without a socket constructor', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		try {
			const bare: AuthBindableProvider = {
				params: {},
				protocols: [],
				on: () => undefined,
				off: () => undefined,
			};
			const unbind = bindProviderAuth(bare, 'tok');
			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no _WS'));
			expect(bare).not.toHaveProperty('_WS');
			expect(bare.params).toEqual({});
			expect(() => {
				unbind();
			}).not.toThrow();
		} finally {
			warnSpy.mockRestore();
		}
	});

	it('ignores a stray third argument, so no caller-supplied state reaches a dial', () => {
		const provider = new FakeProvider();
		provider.params = { room: 'r1' };
		const bindLoose = bindProviderAuth as (...args: unknown[]) => () => void;
		let n = 0;
		bindLoose(provider, () => `t-${++n}`, {
			params: { token: 'stale' },
			protocols: ['bearer.stale'],
		});
		provider.dial();
		expect(provider.dials).toEqual([{ url: 'ws://x/room?room=r1&token=t-1', protocols: [] }]);
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
		expect(NoopSocket.last).not.toBeNull();
		expect(NoopSocket.last!.url).toBe('ws://localhost:1234/room?token=sekret');
		expect(provider.params).toEqual({});
		disconnect();
	});

	it('merges auth token with caller-supplied params in the dial only', () => {
		NoopSocket.last = null;
		const doc = new Y.Doc();
		const { provider, disconnect } = connectProvider({
			url: 'ws://localhost:1234',
			room: 'room',
			doc,
			connect: true,
			disableBc: true,
			WebSocketPolyfill: NoopSocket as unknown as typeof WebSocket,
			params: { v: '2' },
			auth: { token: 'abc', param: 'access_token' },
		});
		expect(NoopSocket.last!.url).toBe('ws://localhost:1234/room?v=2&access_token=abc');
		expect(provider.params).toEqual({ v: '2' });
		disconnect();
	});

	it('resolves a rotating token for every dial and none before the first', () => {
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
		expect(n).toBe(0);
		expect(NoopSocket.last).toBeNull();

		provider.connect();
		expect(NoopSocket.last!.url).toContain('token=tok-1');

		provider.disconnect();
		provider.connect();
		expect(NoopSocket.last!.url).toContain('token=tok-2');
		expect(n).toBe(2);
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
		expect(NoopSocket.last!.protocols).toEqual(['bearer.tok']);
		expect(NoopSocket.last!.url).toBe('ws://localhost:1234/room');
		disconnect();
	});

	it('puts back the socket constructor and resolves no token after disconnect', () => {
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
		expect(provider._WS).not.toBe(NoopSocket);
		disconnect();
		expect(provider._WS).toBe(NoopSocket);
		expect(n).toBe(0);
	});
});
