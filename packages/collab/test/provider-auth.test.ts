import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { ProblemError } from '@sveltesentio/core/problem';
import {
	type AuthBindableProvider,
	type AuthBinding,
	type ConnectedProvider,
	type ConnectProviderOptions,
	COLLAB_AUTH_NOT_BOUND_TYPE,
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
 * `dials` records every socket the original constructor built. `shouldConnect`
 * and `ws` mirror the y-websocket fields a stop writes and reads.
 */
class FakeProvider implements AuthBindableProvider {
	params: Record<string, string> = {};
	protocols: string[] = [];
	shouldConnect = true;
	ws: unknown = null;
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

/**
 * A provider whose socket constructor throws `reject(url)` on its first dial; by
 * default a `SyntaxError`, as `new WebSocket()` throws on a bad URL or a
 * repeated subprotocol.
 */
function strictProvider(
	reject: (url: string) => Error = (url) => new SyntaxError(`invalid dial ${url}`),
): FakeProvider {
	const provider = new FakeProvider();
	const Recording = provider.original as unknown as typeof NoopSocket;
	let rejectNext = true;
	class StrictSocket extends Recording {
		constructor(url: string, protocols?: string | string[]) {
			if (rejectNext) {
				rejectNext = false;
				throw reject(url);
			}
			super(url, protocols);
		}
	}
	provider._WS = StrictSocket as unknown as SocketConstructor;
	return provider;
}

/** A provider holding `ws`, as y-websocket's does once it has dialed. */
function dialedProvider(ws: unknown): FakeProvider {
	const provider = new FakeProvider();
	provider.ws = ws;
	return provider;
}

/** Calls `body` with `console.error` muted and returns the logged lines. */
function withErrors(body: () => void): unknown[][] {
	const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
	try {
		body();
		return errorSpy.mock.calls.map((call): unknown[] => [...(call as unknown[])]);
	} finally {
		errorSpy.mockRestore();
	}
}

/** The one `node:vm` call the realm test makes; collab type-checks without `@types/node`. */
interface VmHost {
	runInNewContext(code: string): unknown;
}

/** A `SyntaxError` built in another realm, as an iframe's `WebSocket` would throw. */
async function foreignSyntaxError(): Promise<Error> {
	const specifier: string = 'node:vm';
	const vm = (await import(specifier)) as VmHost;
	return vm.runInNewContext('new SyntaxError("invalid dial")') as Error;
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

	it('keeps a __proto__ param as a query key', () => {
		const { params } = resolveAuthParams({ token: 'tok', param: '__proto__' });
		expect(Object.keys(params)).toEqual(['__proto__']);
		expect(Object.getOwnPropertyDescriptor(params, '__proto__')?.value).toBe('tok');
		expect(Object.getPrototypeOf(params)).toBe(Object.prototype);

		const provider = new FakeProvider();
		bindProviderAuth(provider, { token: 'tok', param: '__proto__' });
		provider.dial();
		provider.build('ws://x/room?__proto__=stale&a=1', []);
		expect(provider.urls()).toEqual(['ws://x/room?__proto__=tok', 'ws://x/room?a=1&__proto__=tok']);
	});
});

describe('bindProviderAuth — token in the dial, part 1', () => {
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
});

describe('bindProviderAuth — token in the dial, part 2', () => {
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
});

describe('bindProviderAuth — query keys', () => {
	it('matches query keys whole and percent-encoded', () => {
		const provider = new FakeProvider();
		provider.params = { 'access token': 'caller', tokenx: '1' };
		bindProviderAuth(provider, { token: 'a b&c', param: 'access token' });
		provider.dial();
		expect(provider.urls()).toEqual(['ws://x/room?tokenx=1&access%20token=a%20b%26c']);
	});

	it('drops a caller pair whose key decodes to the auth key', () => {
		const provider = new FakeProvider();
		bindProviderAuth(provider, 'tok');
		provider.build('ws://x/room?%74oken=stale&to%6Ben=s2&?token=kept&%zz=1&token%=2', []);
		bindProviderAuth(provider, { token: 'tok', param: 'access token' });
		provider.build('ws://x/room?access+token=old&access%20token=old2&access%2Btoken=keep', []);
		expect(provider.urls()).toEqual([
			'ws://x/room??token=kept&%zz=1&token%=2&token=tok',
			'ws://x/room?access%2Btoken=keep&access%20token=tok',
		]);
	});

	it('drops a caller key split by a tab or newline, which URL parsing removes', () => {
		const provider = new FakeProvider();
		bindProviderAuth(provider, 'tok');
		provider.build('ws://x/room?to\tken=stale&tok\nen=s2&\rtoken=s3&a=1', []);
		provider.build('ws://x/ro\tom?a=b\nc#f\tg', []);
		provider.build('ws://x/room?to\u000Bken=keep&tok%09en=keep2', []);
		expect(provider.urls()).toEqual([
			'ws://x/room?a=1&token=tok',
			'ws://x/room?a=bc&token=tok#fg',
			'ws://x/room?to\u000Bken=keep&tok%09en=keep2&token=tok',
		]);
		const sent = provider.urls().map((url) => new URL(url).searchParams.getAll('token'));
		expect(sent).toEqual([['tok'], ['tok'], ['tok']]);
	});

	it('keeps a query pair without a value and drops an empty one', () => {
		const provider = new FakeProvider();
		bindProviderAuth(provider, 'tok');
		provider.build('ws://x/room?flag&&token=old', []);
		expect(provider.urls()).toEqual(['ws://x/room?flag&token=tok']);
	});

	it('reads the query from the first ? to the fragment, as a server does', () => {
		const provider = new FakeProvider();
		bindProviderAuth(provider, 'tok');
		provider.build('ws://x/s?token=old&next=a?b/room?p=1', []);
		provider.build('ws://x/a?b?token=old', []);
		provider.build('ws://x/room?token=old#f?token=x', []);
		provider.build('ws://x/room#f?token=old', []);
		provider.build('ws://x/room?', []);
		expect(provider.urls()).toEqual([
			'ws://x/s?next=a?b/room?p=1&token=tok',
			'ws://x/a?b?token=old&token=tok',
			'ws://x/room?token=tok#f?token=x',
			'ws://x/room?token=tok#f?token=old',
			'ws://x/room?token=tok',
		]);
	});
});

describe('bindProviderAuth — subprotocols', () => {
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
});

describe('bindProviderAuth — refused dial events, part 1', () => {
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
			expect(errorEvent).toBeInstanceOf(Event);
			expect(errorEvent).not.toHaveProperty('error');
			expect(closeEvent?.code).toBe(1006);
			expect(closeEvent?.reason).toBe('auth token resolver threw');
			expect(closeEvent?.wasClean).toBe(false);
			expect(socket.readyState).toBe(socket.CLOSED);
			expect(errorSpy).toHaveBeenCalledWith(
				'[sentio] collab: auth token resolver threw; dial refused:',
				'Error',
			);
			// A resolver throw can pass, so the provider keeps reconnecting.
			expect(provider.shouldConnect).toBe(true);

			provider.dial();
			expect(provider.urls()).toEqual(['ws://x/room?token=tok2']);
		} finally {
			errorSpy.mockRestore();
		}
	});
});

describe('bindProviderAuth — refused dial events, part 2', () => {
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
});

describe('bindProviderAuth — refused dial events, part 3', () => {
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
});

describe('bindProviderAuth — refused dial events, part 4', () => {
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
			const errors: Event[] = [];
			const closeCodes: number[] = [];
			socket.onerror = () => seen.push('onerror');
			socket.addEventListener('error', (event) => {
				seen.push('error listener');
				errors.push(event);
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
			expect(errors).toHaveLength(1);
			expect(errors[0]).not.toHaveProperty('error');
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
});

describe('bindProviderAuth — refused dial events, part 5', () => {
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
});

describe('bindProviderAuth — refusal logs, part 1', () => {
	it('logs only the name of a resolver error', async () => {
		const provider = new FakeProvider();
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			bindProviderAuth(provider, () => {
				throw new RangeError('token tok-secret was rejected');
			});
			const socket = provider.dial();
			await Promise.resolve();
			expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('dial refused'), 'RangeError');
			expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('tok-secret');
			expect(socket.readyState).toBe(socket.CLOSED);
		} finally {
			errorSpy.mockRestore();
		}
	});

	it('withholds a custom error name, which a thrower can fill with the token', async () => {
		const provider = new FakeProvider();
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		class TokenError extends Error {
			override name = 'TokenError tok-secret';
		}
		try {
			bindProviderAuth(provider, () => {
				throw new TokenError('rejected');
			});
			const socket = provider.dial();
			socket.onerror = () => {
				throw Object.assign(new Error('handler'), { name: 'tok-secret' });
			};
			await Promise.resolve();
			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining('dial refused'),
				'custom Error',
			);
			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining('socket event handler threw'),
				'custom Error',
			);
			expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('tok-secret');
		} finally {
			errorSpy.mockRestore();
		}
	});
});

describe('bindProviderAuth — refusal logs, part 2', () => {
	it('logs a native error name as is, also on a subclass that keeps it', async () => {
		const provider = new FakeProvider();
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		class PlainSubclass extends Error {}
		const thrown: readonly Error[] = [
			new PlainSubclass('a'),
			new AggregateError([], 'b'),
			new URIError('c'),
		];
		try {
			let calls = 0;
			bindProviderAuth(provider, () => {
				const next = thrown.at(calls) ?? new RangeError('only three dials');
				calls += 1;
				throw next;
			});
			for (let i = 0; i < thrown.length; i += 1) provider.dial();
			await Promise.resolve();
			expect(errorSpy.mock.calls.map((call: readonly unknown[]) => call[1])).toEqual([
				'Error',
				'AggregateError',
				'URIError',
			]);
		} finally {
			errorSpy.mockRestore();
		}
	});
});

describe('bindProviderAuth — resolver rebinding, part 1', () => {
	it('refuses the dial when the resolver replaces its binding, and the next dial uses the new one', async () => {
		const provider = new FakeProvider();
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			let oldCalls = 0;
			bindProviderAuth(provider, () => {
				oldCalls += 1;
				bindProviderAuth(provider, 'tok-new');
				return 'tok-old';
			});
			const socket = provider.dial();
			let reason = '';
			socket.onclose = (event) => {
				reason = event.reason;
			};
			await Promise.resolve();
			expect(provider.dials).toEqual([]);
			expect(reason).toBe('auth binding replaced while its token resolved');
			expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('binding replaced'));
			expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('tok-old');

			provider.dial();
			expect(provider.urls()).toEqual(['ws://x/room?token=tok-new']);
			expect(oldCalls).toBe(1);
		} finally {
			errorSpy.mockRestore();
		}
	});

	it('refuses the dial when the resolver unbinds its own binding, and the next dial is anonymous', async () => {
		const provider = new FakeProvider();
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			const unbind = bindProviderAuth(provider, () => {
				unbind();
				return 'tok-old';
			});
			const socket = provider.dial();
			await Promise.resolve();
			expect(provider.dials).toEqual([]);
			expect(socket.readyState).toBe(socket.CLOSED);
			expect(provider._WS).toBe(provider.original);

			provider.dial();
			expect(provider.urls()).toEqual(['ws://x/room']);
		} finally {
			errorSpy.mockRestore();
		}
	});
});

describe('bindProviderAuth — resolver rebinding, part 2', () => {
	it('keeps the token when the resolver binds a different provider', () => {
		const provider = new FakeProvider();
		const other = new FakeProvider();
		bindProviderAuth(provider, () => {
			bindProviderAuth(other, 'tok-other');
			return 'tok';
		});
		provider.dial();
		other.dial();
		expect(provider.urls()).toEqual(['ws://x/room?token=tok']);
		expect(other.urls()).toEqual(['ws://x/room?token=tok-other']);
	});
});

describe('bindProviderAuth — encoding refusals, part 1', () => {
	it('refuses a dial whose token cannot be encoded, then dials once it can', async () => {
		const provider = new FakeProvider();
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const issued = ['tok\uD800', 'tok\uDC00x', 'tok'];
		try {
			let calls = 0;
			bindProviderAuth(provider, () => {
				const next = issued.at(calls) ?? null;
				calls += 1;
				return next;
			});
			const first = provider.dial();
			const second = provider.dial();
			const reasons: string[] = [];
			first.onclose = (event) => reasons.push(event.reason);
			second.onclose = (event) => reasons.push(event.reason);
			await Promise.resolve();
			expect(provider.dials).toEqual([]);
			expect(reasons).toEqual([
				'auth token cannot be encoded for the dial',
				'auth token cannot be encoded for the dial',
			]);
			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining('cannot be encoded'),
				'URIError',
			);

			provider.dial();
			expect(provider.urls()).toEqual(['ws://x/room?token=tok']);
		} finally {
			errorSpy.mockRestore();
		}
	});

	it('refuses a dial whose auth param key cannot be encoded', async () => {
		const provider = new FakeProvider();
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			bindProviderAuth(provider, { token: 'tok', param: 'key\uDBFF' });
			const socket = provider.dial();
			await Promise.resolve();
			expect(provider.dials).toEqual([]);
			expect(socket.readyState).toBe(socket.CLOSED);
			// A fixed token's param key fails every dial the same way, so the refusal stops the provider.
			expect(provider.shouldConnect).toBe(false);
			expect(errorSpy).toHaveBeenCalledWith(
				'[sentio] collab: fixed auth token cannot be encoded for the dial; dial refused, provider stopped until connect() is called:',
				'URIError',
			);
		} finally {
			errorSpy.mockRestore();
		}
	});
});

describe('bindProviderAuth — encoding refusals, fixed token', () => {
	it.each([
		['a lone surrogate in the query token', 'tok\uD800', 'URIError'],
		[
			'a subprotocol token outside RFC 6455',
			{ token: 'a b', param: null, protocol: 'bearer' },
			null,
		],
	] as const)(
		'stops the provider on a fixed token that cannot be encoded (%s)',
		async (_label, auth, cause) => {
			const provider = new FakeProvider();
			const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
			try {
				bindProviderAuth(provider, auth);
				const socket = provider.dial();
				const reasons: string[] = [];
				socket.onclose = (event) => reasons.push(event.reason);
				await Promise.resolve();
				expect(provider.dials).toEqual([]);
				expect(reasons).toEqual(['fixed auth token cannot be encoded for the dial']);
				expect(provider.shouldConnect).toBe(false);
				const line =
					'[sentio] collab: fixed auth token cannot be encoded for the dial; dial refused, provider stopped until connect() is called';
				expect(errorSpy.mock.calls).toEqual([cause === null ? [line] : [`${line}:`, cause]]);
			} finally {
				errorSpy.mockRestore();
			}
		},
	);

	it('keeps the provider running on a resolved token that cannot be encoded (negative)', async () => {
		const provider = new FakeProvider();
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			bindProviderAuth(provider, () => 'tok\uD800');
			provider.dial();
			await Promise.resolve();
			expect(provider.dials).toEqual([]);
			expect(provider.shouldConnect).toBe(true);
			expect(errorSpy).toHaveBeenCalledWith(
				'[sentio] collab: auth token cannot be encoded for the dial; dial refused:',
				'URIError',
			);
		} finally {
			errorSpy.mockRestore();
		}
	});
});

describe('bindProviderAuth — encoding refusals, part 2', () => {
	it('encodes a well-formed surrogate pair in the token', () => {
		const provider = new FakeProvider();
		bindProviderAuth(provider, 'tok\u{1F600}');
		provider.dial();
		expect(provider.urls()).toEqual(['ws://x/room?token=tok%F0%9F%98%80']);
	});

	it('refuses a dial whose auth subprotocol is not an RFC 6455 token', async () => {
		const provider = new FakeProvider();
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const issued = ['a=b', 'a b', 'a,b', 'a/b', 'caf\u00e9'];
		try {
			let calls = 0;
			bindProviderAuth(provider, {
				token: () => {
					const next = issued.at(calls) ?? null;
					calls += 1;
					return next;
				},
				param: null,
				protocol: 'bearer',
			});
			const sockets = issued.map(() => provider.dial());
			await Promise.resolve();
			expect(provider.dials).toEqual([]);
			expect(sockets.every((socket) => socket.readyState === socket.CLOSED)).toBe(true);
			expect(errorSpy).toHaveBeenCalledTimes(issued.length);
			expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('cannot be encoded'));
			expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('bearer.');
		} finally {
			errorSpy.mockRestore();
		}
	});

	it('sends an auth subprotocol made of every RFC 6455 token character', () => {
		const provider = new FakeProvider();
		const token = "!#$%&'*+-.^_`|~09AZaz";
		bindProviderAuth(provider, { token, param: null, protocol: 'bearer' });
		provider.dial();
		expect(provider.dials).toEqual([{ url: 'ws://x/room', protocols: [`bearer.${token}`] }]);
	});
});

describe('bindProviderAuth — encoding refusals, part 3', () => {
	it('refuses a token ending in a line terminator', async () => {
		const provider = new FakeProvider();
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const issued = ['tok\n', 'tok\r', 'tok ', 'tok ', 'tok\r\n', 'tok'];
		try {
			let calls = 0;
			bindProviderAuth(provider, {
				token: () => {
					const next = issued.at(calls) ?? null;
					calls += 1;
					return next;
				},
				param: null,
				protocol: 'bearer',
			});
			const sockets = issued.map(() => provider.dial());
			await Promise.resolve();
			expect(provider.dials).toEqual([{ url: 'ws://x/room', protocols: ['bearer.tok'] }]);
			expect(sockets.slice(0, -1).every((socket) => socket.readyState === socket.CLOSED)).toBe(
				true,
			);
			expect(errorSpy).toHaveBeenCalledTimes(issued.length - 1);
			expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('cannot be encoded'));
		} finally {
			errorSpy.mockRestore();
		}
	});
});

describe('bindProviderAuth — transport recheck', () => {
	it('refuses a dial whose binding lost its transport after binding', async () => {
		const provider = new FakeProvider();
		const binding: { token: string; param: string | null; protocol?: string } = {
			token: 'tok-secret',
			param: 'token',
		};
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			bindProviderAuth(provider, binding);
			// Positive: the transport checked at bind time carries the token.
			provider.dial();
			// Negative: param null and no protocol refuse the dial instead of sending it bare.
			binding.param = null;
			const refused = provider.dial();
			await Promise.resolve();
			expect(refused.readyState).toBe(refused.CLOSED);
			expect(provider.shouldConnect).toBe(true);
			// Boundary: with no token there is nothing to carry, so the dial goes out as is.
			binding.token = '';
			provider.dial();
			// Positive: a subprotocol gives the token a transport again on the next dial.
			binding.token = 'tok-secret';
			binding.protocol = 'bearer';
			provider.dial();
			expect(provider.dials).toEqual([
				{ url: 'ws://x/room?token=tok-secret', protocols: [] },
				{ url: 'ws://x/room', protocols: [] },
				{ url: 'ws://x/room', protocols: ['bearer.tok-secret'] },
			]);
			expect(errorSpy.mock.calls).toEqual([
				['[sentio] collab: auth binding has no transport for its token; dial refused'],
			]);
		} finally {
			errorSpy.mockRestore();
		}
	});
});

describe('bindProviderAuth — permanent refusals, part 1', () => {
	it('refuses a dial over the entry bound, auth entries counted, and stops the provider', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const pairs = (count: number, first = 'k0=v'): string =>
			[first, ...Array.from({ length: count - 1 }, (_, i) => `k${String(i + 1)}=v`)].join('&');
		const entries = (count: number): string[] =>
			Array.from({ length: count }, (_, i) => `p${String(i)}`);
		try {
			const viaQuery = new FakeProvider();
			let resolved = 0;
			bindProviderAuth(viaQuery, () => {
				resolved += 1;
				return 'tok';
			});
			// Positive: 3999 caller pairs plus the token pair is 4000.
			viaQuery.build(`ws://x/room?${pairs(3999)}`, []);
			// Boundary: a caller token pair is replaced, so 4000 pairs stay 4000.
			viaQuery.build(`ws://x/room?${pairs(4000, 'token=guest')}`, []);
			// Negative: the token pair takes 4000 caller pairs to 4001.
			const overByAuth = viaQuery.build(`ws://x/room?${pairs(4000)}`, []);
			// Negative: 4001 caller pairs are refused before the token resolves.
			const overByCaller = viaQuery.build(`ws://x/room?${pairs(4001)}`, []);
			expect(resolved).toBe(3);
			expect(viaQuery.urls()).toEqual([
				`ws://x/room?${pairs(3999)}&token=tok`,
				`ws://x/room?${pairs(4000).replace(/^k0=v&/, '')}&token=tok`,
			]);

			const viaProtocol = new FakeProvider();
			bindProviderAuth(viaProtocol, { token: () => 'tok', param: null, protocol: 'bearer' });
			viaProtocol.build('ws://x/room', entries(3999));
			const overByAuthProtocol = viaProtocol.build('ws://x/room', entries(4000));
			const overByCallerProtocol = viaProtocol.build('ws://x/room', entries(4001));
			expect(viaProtocol.dials).toHaveLength(1);
			expect(viaProtocol.dials[0]?.protocols).toHaveLength(4000);
			expect(viaProtocol.dials[0]?.protocols.at(-1)).toBe('bearer.tok');

			await Promise.resolve();
			for (const socket of [overByAuth, overByCaller, overByAuthProtocol, overByCallerProtocol]) {
				expect(socket.readyState).toBe(socket.CLOSED);
			}
			expect(errorSpy).toHaveBeenCalledTimes(4);
			expect(errorSpy).toHaveBeenCalledWith(
				'[sentio] collab: dial exceeds the query pair or subprotocol bound; dial refused, provider stopped until connect() is called',
			);
			expect(viaQuery.shouldConnect).toBe(false);
			expect(viaProtocol.shouldConnect).toBe(false);
		} finally {
			errorSpy.mockRestore();
		}
	});
});

describe('bindProviderAuth — permanent refusals, part 2', () => {
	it('stops the provider on a dial the socket constructor rejects', async () => {
		const provider = strictProvider();
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			bindProviderAuth(provider, 'tok-secret');
			const refused = provider.dial();
			expect(provider.dials).toEqual([]);
			await Promise.resolve();
			expect(refused.readyState).toBe(refused.CLOSED);
			expect(errorSpy).toHaveBeenCalledWith(
				'[sentio] collab: socket constructor rejected the dial; dial refused, provider stopped until connect() is called:',
				'SyntaxError',
			);
			expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('tok-secret');
			expect(provider.shouldConnect).toBe(false);

			// connect() sets shouldConnect again and dials through the binding.
			provider.shouldConnect = true;
			provider.dial();
			expect(provider.urls()).toEqual(['ws://x/room?token=tok-secret']);
		} finally {
			errorSpy.mockRestore();
		}
	});

	it('says so when a rejected dial cannot stop a provider frozen after binding (boundary)', () => {
		const provider = strictProvider();
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			bindProviderAuth(provider, 'tok');
			Object.freeze(provider);
			provider.dial();
			expect(errorSpy).toHaveBeenCalledWith(
				'[sentio] collab: socket constructor rejected the dial; dial refused, provider not stopped:',
				'SyntaxError',
			);
			expect(provider.shouldConnect).toBe(true);
		} finally {
			errorSpy.mockRestore();
		}
	});
});

describe('bindProviderAuth — permanent refusals, part 3', () => {
	it('retries a dial the socket constructor throws on with another error', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			// Negative: an Error that only calls itself SyntaxError, as a polyfill's own error may, is retried.
			const renamed = (url: string): Error =>
				Object.assign(new Error(url), { name: 'SyntaxError' });
			const rejects = [
				(url: string) => new TypeError(url),
				(url: string) => new Error(url),
				renamed,
			];
			for (const reject of rejects) {
				const provider = strictProvider(reject);
				bindProviderAuth(provider, 'tok-secret');
				const refused = provider.dial();
				await Promise.resolve();
				expect(refused.readyState).toBe(refused.CLOSED);
				expect(provider.shouldConnect).toBe(true);
				// The next dial, after y-websocket's backoff, goes through.
				provider.dial();
				expect(provider.urls()).toEqual(['ws://x/room?token=tok-secret']);
			}
			expect(errorSpy.mock.calls).toEqual([
				['[sentio] collab: socket constructor threw; dial refused:', 'TypeError'],
				['[sentio] collab: socket constructor threw; dial refused:', 'Error'],
				['[sentio] collab: socket constructor threw; dial refused:', 'SyntaxError'],
			]);
			expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('tok-secret');

			// Boundary: the DOMException Node's global WebSocket throws stops it.
			const strict = strictProvider((url) => new DOMException(url, 'SyntaxError'));
			bindProviderAuth(strict, 'tok');
			strict.dial();
			expect(strict.shouldConnect).toBe(false);
			expect(errorSpy).toHaveBeenLastCalledWith(
				'[sentio] collab: socket constructor rejected the dial; dial refused, provider stopped until connect() is called:',
				'SyntaxError',
			);
		} finally {
			errorSpy.mockRestore();
		}
	});

	it('retries a constructor DOMException of another name and an unreadable throw (boundary)', () => {
		const errors = withErrors(() => {
			// Negative: only a DOMException named SyntaxError is a rejected dial.
			const network = strictProvider((url) => new DOMException(url, 'NetworkError'));
			// Boundary: a thrown value whose prototype cannot be read is retried, not raised.
			const unreadable = strictProvider(
				(url) =>
					new Proxy(new Error(url), {
						getPrototypeOf(): object | null {
							throw new TypeError('getPrototypeOf trap');
						},
					}),
			);
			for (const provider of [network, unreadable]) {
				bindProviderAuth(provider, 'tok');
				provider.dial();
				expect(provider.shouldConnect).toBe(true);
				provider.dial();
				expect(provider.urls()).toEqual(['ws://x/room?token=tok']);
			}
		});
		expect(errors).toEqual([
			['[sentio] collab: socket constructor threw; dial refused:', 'custom Error'],
			['[sentio] collab: socket constructor threw; dial refused:', 'unreadable thrown value'],
		]);
	});

	it('counts only non-empty query pairs against the entry bound', () => {
		const pairs = (count: number): string =>
			Array.from({ length: count }, (_, i) => `k${String(i)}=v`).join('&');
		const viaProtocol = new FakeProvider();
		const viaQuery = new FakeProvider();
		const errors = withErrors(() => {
			bindProviderAuth(viaProtocol, { token: 'tok', param: null, protocol: 'bearer' });
			bindProviderAuth(viaQuery, 'tok');
			// Positive: empty pairs around 4000 non-empty ones do not count.
			viaProtocol.build(`ws://x/room?&&${pairs(4000)}&&&`, []);
			// Boundary: a query of empty pairs only holds no pair at all.
			viaProtocol.build(`ws://x/room?${'&'.repeat(5000)}`, []);
			// Positive: the token pair joins 3999 caller pairs; empty ones are dropped.
			viaQuery.build(`ws://x/room?&&${pairs(3999)}&`, []);
			// Negative: 4001 non-empty pairs are refused.
			viaProtocol.build(`ws://x/room?${pairs(4001)}&`, []);
		});
		expect(viaProtocol.urls()).toEqual([
			`ws://x/room?&&${pairs(4000)}&&&`,
			`ws://x/room?${'&'.repeat(5000)}`,
		]);
		expect(viaQuery.urls()).toEqual([`ws://x/room?${pairs(3999)}&token=tok`]);
		expect(errors).toEqual([
			[
				'[sentio] collab: dial exceeds the query pair or subprotocol bound; dial refused, provider stopped until connect() is called',
			],
		]);
		expect(viaProtocol.shouldConnect).toBe(false);
		expect(viaQuery.shouldConnect).toBe(true);
	});
});

describe('bindProviderAuth — permanent refusals, part 4', () => {
	it('retries a SyntaxError from another realm', async () => {
		const foreign = await foreignSyntaxError();
		expect(foreign instanceof SyntaxError).toBe(false);
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			const provider = strictProvider(() => foreign);
			bindProviderAuth(provider, 'tok-secret');
			const refused = provider.dial();
			await Promise.resolve();
			expect(refused.readyState).toBe(refused.CLOSED);
			expect(provider.shouldConnect).toBe(true);
			provider.dial();
			expect(provider.urls()).toEqual(['ws://x/room?token=tok-secret']);
			expect(errorSpy.mock.calls).toEqual([
				['[sentio] collab: socket constructor threw; dial refused:', 'object'],
			]);
		} finally {
			errorSpy.mockRestore();
		}
	});
});

describe('bindProviderAuth — thrown value labels, part 1', () => {
	it('labels a thrown value it cannot read, and the next dial goes through', async () => {
		const provider = new FakeProvider();
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			const unreadableName = new Error('tok-secret');
			Object.defineProperty(unreadableName, 'name', {
				get(): string {
					throw new TypeError('name getter');
				},
			});
			const trappedProxy = new Proxy(
				{},
				{
					getPrototypeOf(): object | null {
						throw new TypeError('getPrototypeOf trap');
					},
				},
			);
			const thrown: unknown[] = [unreadableName, trappedProxy];
			let n = 0;
			bindProviderAuth(provider, () => {
				const value = thrown[n];
				n += 1;
				// eslint-disable-next-line @typescript-eslint/only-throw-error -- a resolver may throw a value whose reads throw; labelling must survive it
				if (value !== undefined) throw value;
				return 'tok';
			});
			const first = provider.dial();
			const second = provider.dial();
			await Promise.resolve();
			provider.dial();
			expect(errorSpy).toHaveBeenCalledTimes(2);
			for (const call of [1, 2]) {
				expect(errorSpy).toHaveBeenNthCalledWith(
					call,
					expect.stringContaining('dial refused'),
					'unreadable thrown value',
				);
			}
			expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('tok-secret');
			expect(first.readyState).toBe(first.CLOSED);
			expect(second.readyState).toBe(second.CLOSED);
			expect(provider.urls()).toEqual(['ws://x/room?token=tok']);
		} finally {
			errorSpy.mockRestore();
		}
	});
});

describe('bindProviderAuth — thrown value labels, part 2', () => {
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
});

describe('bindProviderAuth — rebind and unbind, part 1', () => {
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
});

describe('bindProviderAuth — rebind and unbind, part 2', () => {
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

	it('keeps one auth layer across rebinds, unbound in any order', () => {
		const provider = new FakeProvider();
		const unbindA = bindProviderAuth(provider, { token: 'tokA', param: 'a' });
		const unbindB = bindProviderAuth(provider, { token: 'tokB', param: 'b' });
		const unbindC = bindProviderAuth(provider, { token: 'tokC', param: 'c' });
		expect(Object.getPrototypeOf(provider._WS)).toBe(provider.original);
		provider.dial();
		unbindA();
		unbindB();
		expect(Object.getPrototypeOf(provider._WS)).toBe(provider.original);
		provider.dial();
		unbindC();
		expect(provider._WS).toBe(provider.original);
		provider.dial();
		expect(provider.urls()).toEqual(['ws://x/room?c=tokC', 'ws://x/room?c=tokC', 'ws://x/room']);
	});

	it('binds over the original socket constructor again after an unbind', () => {
		const provider = new FakeProvider();
		bindProviderAuth(provider, 'tok1')();
		bindProviderAuth(provider, 'tok2');
		expect(Object.getPrototypeOf(provider._WS)).toBe(provider.original);
		provider.dial();
		expect(provider.urls()).toEqual(['ws://x/room?token=tok2']);
	});

	it('keeps a wrapper put over a binding when rebinding, and puts it back on unbind', () => {
		const provider = new FakeProvider();
		bindProviderAuth(provider, { token: 'tokA', param: 'a' });
		const Wrapper = class extends provider._WS {};
		provider._WS = Wrapper;
		const unbindB = bindProviderAuth(provider, { token: 'tokB', param: 'b' });
		expect(Object.getPrototypeOf(provider._WS)).toBe(Wrapper);
		provider.dial();
		unbindB();
		expect(provider._WS).toBe(Wrapper);
		provider.dial();
		expect(provider.urls()).toEqual(['ws://x/room?b=tokB', 'ws://x/room']);
	});
});

describe('bindProviderAuth — refused binding, part 1', () => {
	it.each([
		['an arrow function', (() => undefined) as unknown as SocketConstructor],
		['a bound class', NoopSocket.bind(null) as unknown as SocketConstructor],
	])(
		'logs an error and binds nothing when _WS is %s, which cannot be subclassed',
		(_label, socket) => {
			const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
			try {
				const provider = new FakeProvider();
				provider._WS = socket;
				const unbind = bindProviderAuth(provider, 'tok');
				expect(errorSpy).toHaveBeenCalledTimes(1);
				expect(errorSpy).toHaveBeenCalledWith(
					expect.stringMatching(
						/cannot be subclassed \(TypeError\); auth not bound, provider stopped$/,
					),
				);
				expect(provider.shouldConnect).toBe(false);
				expect(provider._WS).toBe(socket);
				unbind();
				expect(provider._WS).toBe(socket);
			} finally {
				errorSpy.mockRestore();
			}
		},
	);

	it('requires a socket constructor on the provider type', () => {
		// @ts-expect-error -- a stand-in without _WS must not compile: no dial could carry the token.
		const bare: AuthBindableProvider = {
			params: {},
			protocols: [],
			on: () => undefined,
			off: () => undefined,
		};
		expect(bare).not.toHaveProperty('_WS');
	});
});

describe('bindProviderAuth — refused binding, part 2', () => {
	it('logs an error and binds nothing on an untyped provider without a socket constructor', () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			const bare = {
				params: {},
				protocols: [],
				on: () => undefined,
				off: () => undefined,
			} as unknown as AuthBindableProvider;
			const unbind = bindProviderAuth(bare, 'tok');
			expect(errorSpy).toHaveBeenCalledTimes(1);
			expect(errorSpy).toHaveBeenCalledWith(
				'[sentio] collab: provider has no _WS socket constructor; auth not bound, provider stopped',
			);
			expect(Reflect.get(bare, 'shouldConnect')).toBe(false);
			expect(bare).not.toHaveProperty('_WS');
			expect(bare.params).toEqual({});
			expect(() => {
				unbind();
			}).not.toThrow();
		} finally {
			errorSpy.mockRestore();
		}
	});

	it('logs an error and binds nothing when _WS is not a constructor', () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			const odd = {
				params: {},
				protocols: [],
				on: () => undefined,
				off: () => undefined,
				_WS: null,
			} as unknown as AuthBindableProvider;
			bindProviderAuth(odd, 'tok');
			expect(errorSpy).toHaveBeenCalledTimes(1);
			expect(odd._WS).toBeNull();
		} finally {
			errorSpy.mockRestore();
		}
	});
});

describe('bindProviderAuth — refused binding, part 3', () => {
	it.each([
		[
			'sealed',
			(provider: FakeProvider): FakeProvider => Object.seal(provider),
			'provider stopped',
			false,
		],
		[
			'frozen',
			(provider: FakeProvider): FakeProvider => Object.freeze(provider),
			'provider not stopped: its dials could not be stopped',
			true,
		],
	] as const)('binds nothing on a %s provider', (_label, lock, outcome, keepsDialing) => {
		const provider = lock(new FakeProvider());
		const errors = withErrors(() => {
			bindProviderAuth(provider, 'tok');
		});
		expect(errors).toEqual([
			[
				`[sentio] collab: provider takes no binding slot (sealed or frozen); auth not bound, ${outcome}`,
			],
		]);
		expect(provider.shouldConnect).toBe(keepsDialing);
		expect(provider._WS).toBe(provider.original);
		provider.dial();
		expect(provider.urls()).toEqual(['ws://x/room']);
	});

	it('rebinds a provider sealed after its first binding, keeping one auth layer', () => {
		const provider = new FakeProvider();
		bindProviderAuth(provider, 'tok1');
		Object.seal(provider);
		bindProviderAuth(provider, 'tok2');
		provider.dial();
		expect(provider.urls()).toEqual(['ws://x/room?token=tok2']);
	});
});

describe('bindProviderAuth — refused binding, part 4', () => {
	it('binds nothing and keeps the earlier binding when _WS is read-only', () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			const provider = new FakeProvider();
			bindProviderAuth(provider, 'tok1');
			const bound = provider._WS;
			Object.defineProperty(provider, '_WS', { value: bound, writable: false });
			const unbind = bindProviderAuth(provider, 'tok2');
			expect(errorSpy).toHaveBeenCalledWith(
				'[sentio] collab: provider _WS is read-only; auth not bound, provider stopped',
			);
			expect(provider.shouldConnect).toBe(false);
			unbind();
			provider.dial();
			expect(provider._WS).toBe(bound);
			expect(provider.urls()).toEqual(['ws://x/room?token=tok1']);

			const fresh = new FakeProvider();
			Object.defineProperty(fresh, '_WS', { value: fresh.original, writable: false });
			bindProviderAuth(fresh, 'tok');
			fresh.dial();
			expect(fresh.urls()).toEqual(['ws://x/room']);
			expect(errorSpy).toHaveBeenCalledTimes(2);
		} finally {
			errorSpy.mockRestore();
		}
	});
});

/** `provider` with `key` replaced by an accessor whose getter or setter throws `error`. */
function throwingField(
	provider: FakeProvider,
	key: '_WS' | 'shouldConnect' | 'ws',
	access: 'get' | 'set',
	error: Error,
): FakeProvider {
	const value: unknown = provider[key];
	const fail = (): never => {
		throw error;
	};
	Object.defineProperty(provider, key, {
		get: access === 'get' ? fail : () => value,
		set: access === 'set' ? fail : () => undefined,
	});
	return provider;
}

describe('bindProviderAuth — refused binding, part 5', () => {
	it('binds nothing when reading the provider throws', () => {
		const reading = throwingField(new FakeProvider(), '_WS', 'get', new TypeError('trap'));
		const writing = new FakeProvider();
		bindProviderAuth(writing, 'tok1');
		throwingField(writing, '_WS', 'set', new RangeError('trap'));
		const errors = withErrors(() => {
			bindProviderAuth(reading, 'tok');
			bindProviderAuth(writing, 'tok2')();
		});
		expect(errors).toEqual([
			[
				'[sentio] collab: reading the auth binding or the provider threw (TypeError); auth not bound, provider stopped',
			],
			[
				'[sentio] collab: writing provider _WS threw (RangeError); auth not bound, provider stopped',
			],
		]);
		expect(reading.shouldConnect).toBe(false);
		expect(writing.shouldConnect).toBe(false);
		// The earlier binding keeps its slot, so dials still carry its token.
		writing.dial();
		expect(writing.urls()).toEqual(['ws://x/room?token=tok1']);
	});

	it('says the provider is not stopped when its shouldConnect setter throws (negative)', () => {
		const provider = throwingField(new FakeProvider(), '_WS', 'get', new TypeError('trap'));
		throwingField(provider, 'shouldConnect', 'set', new TypeError('frozen'));
		const errors = withErrors(() => {
			bindProviderAuth(provider, 'tok');
		});
		expect(errors).toEqual([
			[
				'[sentio] collab: reading the auth binding or the provider threw (TypeError); auth not bound, provider not stopped: its dials could not be stopped',
			],
		]);
	});

	it('stops a first binding whose provider ws read throws (boundary)', () => {
		const provider = throwingField(new FakeProvider(), 'ws', 'get', new TypeError('trap'));
		const errors = withErrors(() => {
			bindProviderAuth(provider, 'tok');
		});
		expect(errors).toEqual([
			[
				'[sentio] collab: provider dialed before auth was bound, without the token; could not stop it (reading or closing its socket threw (TypeError)), so that socket may stay open without the token. Construct it with connect: false and call connect() after bindProviderAuth.',
			],
		]);
		expect(provider.shouldConnect).toBe(false);
		provider.dial();
		expect(provider.urls()).toEqual(['ws://x/room?token=tok']);
	});
});

/**
 * Makes the provider's binding slot take one more write, then throw on the
 * next, so a rebind's rollback of that slot throws.
 */
function slotThrowsOnRollback(provider: FakeProvider): void {
	const [slotKey] = Object.getOwnPropertySymbols(provider);
	if (slotKey === undefined) throw new Error('provider has no binding slot');
	let value: unknown = Reflect.get(provider, slotKey);
	let writes = 0;
	Object.defineProperty(provider, slotKey, {
		get: () => value,
		set: (next: unknown) => {
			writes += 1;
			if (writes > 1) throw new RangeError('trap');
			value = next;
		},
	});
}

describe('bindProviderAuth — refused binding, part 6', () => {
	it('refuses and stops the provider when rolling a rebind back throws', () => {
		const provider = new FakeProvider();
		bindProviderAuth(provider, 'tok1');
		Object.defineProperty(provider, '_WS', { value: provider._WS, writable: false });
		slotThrowsOnRollback(provider);
		const errors = withErrors(() => {
			bindProviderAuth(provider, 'tok2')();
		});
		expect(errors).toEqual([
			[
				'[sentio] collab: reading the auth binding or the provider threw (RangeError); auth not bound, provider stopped',
			],
		]);
		expect(provider.shouldConnect).toBe(false);
		// The slot keeps the refused binding, so the earlier one adds no token (#589).
		provider.dial();
		expect(provider.urls()).toEqual(['ws://x/room']);
	});
});

describe('bindProviderAuth — refused binding, part 7', () => {
	it.each([
		[
			'frozen after its first binding',
			(provider: FakeProvider): void => {
				Object.freeze(provider);
			},
			'provider takes no binding slot (sealed or frozen)',
		],
		[
			'a read-only _WS and a shouldConnect setter that ignores the write',
			(provider: FakeProvider): void => {
				Object.defineProperty(provider, '_WS', { value: provider._WS, writable: false });
				Object.defineProperty(provider, 'shouldConnect', {
					get: () => true,
					set: (): void => {
						// Drops the write, so the provider keeps dialing.
					},
				});
			},
			'provider _WS is read-only',
		],
		[
			'a wrapper over the earlier binding, then frozen',
			(provider: FakeProvider): void => {
				provider._WS = class extends provider._WS {};
				Object.freeze(provider);
			},
			'provider takes no binding slot (sealed or frozen)',
		],
	] as const)(
		'closes the earlier binding when a refused rebind cannot stop the provider (%s)',
		async (_label, lock, refused) => {
			const provider = new FakeProvider();
			bindProviderAuth(provider, 'tok1');
			lock(provider);
			const reasons: string[] = [];
			const errors = withErrors(() => {
				bindProviderAuth(provider, 'tok2');
				const socket = provider.dial();
				socket.onclose = (event) => reasons.push(event.reason);
			});
			await Promise.resolve();
			expect(errors).toEqual([
				[
					`[sentio] collab: ${refused}; auth not bound, provider not stopped: its dials could not be stopped; earlier binding closed`,
				],
				[
					'[sentio] collab: auth binding closed by a refused rebind; dial refused, provider not stopped',
				],
			]);
			expect(reasons).toEqual(['auth binding closed by a refused rebind']);
			expect(provider.dials).toEqual([]);
			expect(provider.shouldConnect).toBe(true);
		},
	);

	it('closes nothing when no binding is installed as _WS (boundary)', () => {
		const provider = new FakeProvider();
		bindProviderAuth(provider, 'tok1')();
		Object.freeze(provider);
		const errors = withErrors(() => {
			bindProviderAuth(provider, 'tok2');
		});
		expect(errors).toEqual([
			[
				'[sentio] collab: provider takes no binding slot (sealed or frozen); auth not bound, provider not stopped: its dials could not be stopped',
			],
		]);
		provider.dial();
		expect(provider.urls()).toEqual(['ws://x/room']);
	});
});

describe('bindProviderAuth — dial before the first binding, part 1', () => {
	it('stops a provider that dialed before the first binding, and dials with the token on connect()', () => {
		const close = vi.fn();
		const provider = dialedProvider({ close });
		const errors = withErrors(() => {
			bindProviderAuth(provider, 'tok1');
			bindProviderAuth(provider, 'tok2');
		});
		expect(close).toHaveBeenCalledTimes(1);
		expect(provider.shouldConnect).toBe(false);
		expect(errors).toEqual([
			[
				'[sentio] collab: provider dialed before auth was bound, without the token; stopped it; call connect() to dial with the token. Construct it with connect: false and call connect() after bindProviderAuth.',
			],
		]);
		// connect() sets shouldConnect again and dials through the binding.
		provider.shouldConnect = true;
		provider.dial();
		expect(provider.urls()).toEqual(['ws://x/room?token=tok2']);
	});

	it('stops nothing when the provider has not dialed (negative)', () => {
		const idle = dialedProvider(null);
		const errors = withErrors(() => {
			bindProviderAuth(idle, 'tok');
			bindProviderAuth(new FakeProvider(), 'tok');
		});
		expect(errors).toEqual([]);
		expect(idle.shouldConnect).toBe(true);
	});
});

describe('bindProviderAuth — dial before the first binding, part 2', () => {
	it.each([
		[
			'throws',
			{
				close: () => {
					throw new TypeError('socket gone');
				},
			},
			'reading or closing its socket threw (TypeError)',
		],
		['is missing', {}, 'its socket has no close()'],
	] as const)(
		'says the socket may stay open when its close() %s, and keeps the binding (boundary)',
		(_label, ws, left) => {
			const provider = dialedProvider(ws);
			const errors = withErrors(() => {
				bindProviderAuth(provider, 'tok');
			});
			expect(errors).toEqual([
				[
					`[sentio] collab: provider dialed before auth was bound, without the token; could not stop it (${left}), so that socket may stay open without the token. Construct it with connect: false and call connect() after bindProviderAuth.`,
				],
			]);
			expect(provider.shouldConnect).toBe(false);
			provider.dial();
			expect(provider.urls()).toEqual(['ws://x/room?token=tok']);
		},
	);
});

describe('bindProviderAuth — binding transport', () => {
	it('refuses a binding with no transport and stops the provider', () => {
		const provider = new FakeProvider();
		const errors = withErrors(() => {
			bindProviderAuth(provider, { token: 'tok', param: null });
		});
		expect(errors).toEqual([
			[
				'[sentio] collab: auth binding has no transport (param is null and protocol is unset); auth not bound, provider stopped',
			],
		]);
		expect(provider.shouldConnect).toBe(false);
		expect(provider._WS).toBe(provider.original);
		provider.dial();
		expect(provider.urls()).toEqual(['ws://x/room']);
	});

	it('binds a token sent only as a subprotocol, with param null (boundary)', () => {
		const provider = new FakeProvider();
		const errors = withErrors(() => {
			bindProviderAuth(provider, { token: 'tok', param: null, protocol: 'bearer' });
		});
		provider.dial();
		expect(errors).toEqual([]);
		expect(provider.dials).toEqual([{ url: 'ws://x/room', protocols: ['bearer.tok'] }]);
	});
});

describe('bindProviderAuth — rebind and unbind, part 3', () => {
	it('stops injecting after unbind on a provider frozen after binding', () => {
		const provider = new FakeProvider();
		let resolved = 0;
		const unbind = bindProviderAuth(provider, () => {
			resolved += 1;
			return 'tok';
		});
		Object.freeze(provider);
		unbind();
		provider.dial();
		expect(provider._WS).not.toBe(provider.original);
		expect(provider.urls()).toEqual(['ws://x/room']);
		expect(resolved).toBe(0);
	});

	it('unbind does not throw when writing the provider back throws', () => {
		const provider = new FakeProvider();
		const unbind = bindProviderAuth(provider, 'tok-secret');
		const AuthSocket = provider._WS;
		Object.defineProperty(provider, '_WS', {
			configurable: true,
			get: () => AuthSocket,
			set: () => {
				throw new TypeError('trap');
			},
		});
		const errors = withErrors(() => {
			expect(() => {
				unbind();
			}).not.toThrow();
		});
		expect(errors).toEqual([['[sentio] collab: unbind threw (TypeError); no token is added']]);
		provider.dial();
		expect(provider.urls()).toEqual(['ws://x/room']);
	});

	it('unbind logs nothing when writing the provider back holds (negative)', () => {
		const provider = new FakeProvider();
		const unbind = bindProviderAuth(provider, 'tok-secret');
		expect(withErrors(unbind)).toEqual([]);
		expect(provider._WS).toBe(provider.original);
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

/** `connectProvider` over the no-op socket, `connect: true` and no broadcast channel. */
function connectNoop(options: Partial<ConnectProviderOptions>): ConnectedProvider {
	NoopSocket.last = null;
	return connectProvider({
		url: 'ws://localhost:1234',
		room: 'room',
		doc: new Y.Doc(),
		connect: true,
		disableBc: true,
		WebSocketPolyfill: NoopSocket as unknown as typeof WebSocket,
		...options,
	});
}

/** The `ProblemError` `connectNoop(options)` throws, with `destroy` counted. */
function refusedConnect(options: Partial<ConnectProviderOptions>): {
	problem: ProblemError;
	destroyed: number;
} {
	const destroySpy = vi.spyOn(WebsocketProvider.prototype, 'destroy');
	try {
		connectNoop(options);
	} catch (error) {
		if (!(error instanceof ProblemError)) throw error;
		return { problem: error, destroyed: destroySpy.mock.calls.length };
	} finally {
		destroySpy.mockRestore();
	}
	throw new Error('connectProvider did not throw');
}

describe('connectProvider — auth in the dial', () => {
	it('attaches a static token to the connect URL as a query param', () => {
		const { provider, disconnect } = connectNoop({ auth: 'sekret' });
		expect(NoopSocket.last).not.toBeNull();
		expect(NoopSocket.last!.url).toBe('ws://localhost:1234/room?token=sekret');
		expect(provider.params).toEqual({});
		disconnect();
	});

	it('merges auth token with caller-supplied params in the dial only', () => {
		const { provider, disconnect } = connectNoop({
			params: { v: '2' },
			auth: { token: 'abc', param: 'access_token' },
		});
		expect(NoopSocket.last!.url).toBe('ws://localhost:1234/room?v=2&access_token=abc');
		expect(provider.params).toEqual({ v: '2' });
		disconnect();
	});

	it('passes the auth subprotocol through to the socket constructor', () => {
		const { disconnect } = connectNoop({ auth: { token: 'tok', param: null, protocol: 'bearer' } });
		expect(NoopSocket.last!.protocols).toEqual(['bearer.tok']);
		expect(NoopSocket.last!.url).toBe('ws://localhost:1234/room');
		disconnect();
	});

	it('connects through a bound socket constructor when no auth is set', () => {
		const { disconnect } = connectNoop({
			WebSocketPolyfill: NoopSocket.bind(null) as unknown as typeof WebSocket,
		});
		expect(NoopSocket.last).not.toBeNull();
		expect(NoopSocket.last!.url).toBe('ws://localhost:1234/room');
		disconnect();
	});
});

describe('connectProvider — token lifetime', () => {
	it('resolves a rotating token for every dial and none before the first', () => {
		let n = 0;
		const { provider, disconnect } = connectNoop({ connect: false, auth: () => `tok-${++n}` });
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

	it('keeps the binding after disconnect, so a later connect() resolves no token and dials nothing', () => {
		let n = 0;
		const { provider, disconnect } = connectNoop({ connect: false, auth: () => `tok-${++n}` });
		const AuthSocket = provider._WS;
		expect(AuthSocket).not.toBe(NoopSocket);
		disconnect();
		expect(provider._WS).toBe(AuthSocket);

		const errors = withErrors(() => {
			provider.connect();
		});
		expect(NoopSocket.last).toBeNull();
		expect(n).toBe(0);
		expect(provider.shouldConnect).toBe(false);
		expect(errors).toEqual([
			[
				'[sentio] collab: provider disconnected by connectProvider; dial refused, provider stopped until connect() is called',
			],
		]);
	});
});

describe('connectProvider — teardown', () => {
	it('disconnect writes nothing back, so a _WS that throws on write still tears down', () => {
		const { provider, disconnect } = connectNoop({ auth: 'tok-secret', connect: false });
		const AuthSocket = provider._WS;
		Object.defineProperty(provider, '_WS', {
			configurable: true,
			get: () => AuthSocket,
			set: () => {
				throw new TypeError('trap');
			},
		});
		const destroySpy = vi.spyOn(provider, 'destroy');
		expect(withErrors(disconnect)).toEqual([]);
		expect(destroySpy).toHaveBeenCalledTimes(1);
		expect(provider.shouldConnect).toBe(false);
		expect(provider._WS).toBe(AuthSocket);
	});

	it('disconnect destroys the provider and rethrows when removing a listener throws', () => {
		const { provider, disconnect } = connectNoop({
			auth: 'tok-secret',
			connect: false,
			onStatusChange: () => undefined,
		});
		vi.spyOn(provider, 'off').mockImplementation(() => {
			throw new TypeError('off');
		});
		const destroySpy = vi.spyOn(provider, 'destroy');
		expect(disconnect).toThrow(TypeError);
		expect(destroySpy).toHaveBeenCalledTimes(1);
		expect(provider.shouldConnect).toBe(false);
	});
});

describe('connectProvider — refused auth binding', () => {
	it.each([true, false])('throws instead of connecting without auth (connect: %s)', (connect) => {
		const { problem, destroyed } = refusedConnect({
			connect,
			WebSocketPolyfill: NoopSocket.bind(null) as unknown as typeof WebSocket,
			auth: 'sekret',
		});
		expect(problem.type).toBe(COLLAB_AUTH_NOT_BOUND_TYPE);
		expect(problem.detail).toBe(
			'provider _WS cannot be subclassed (TypeError); the provider was destroyed before any dial',
		);
		expect(destroyed).toBe(1);
		expect(NoopSocket.last).toBeNull();
	});

	it('throws instead of connecting when reading the auth binding throws', () => {
		const auth: AuthBinding = {
			token: 'sekret',
			get param(): string {
				throw new TypeError('trap');
			},
		};
		const { problem, destroyed } = refusedConnect({ auth });
		expect(problem.type).toBe(COLLAB_AUTH_NOT_BOUND_TYPE);
		expect(problem.detail).toBe(
			'reading the auth binding or the provider threw (TypeError); the provider was destroyed before any dial',
		);
		expect(destroyed).toBe(1);
		expect(NoopSocket.last).toBeNull();
	});

	it('throws instead of connecting when the binding has no transport', () => {
		const { problem, destroyed } = refusedConnect({ auth: { token: 'sekret', param: null } });
		expect(problem.type).toBe(COLLAB_AUTH_NOT_BOUND_TYPE);
		expect(problem.detail).toBe(
			'auth binding has no transport (param is null and protocol is unset); the provider was destroyed before any dial',
		);
		expect(destroyed).toBe(1);
		expect(NoopSocket.last).toBeNull();
	});
});
