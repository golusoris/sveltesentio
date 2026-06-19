import { describe, it, expect, vi } from 'vitest';
import { ProblemError } from '@sveltesentio/core';
import { createClient } from '../src/client.js';
import { authMiddleware, type TokenStore } from '../src/auth-middleware.js';

interface Paths {
	'/me': {
		get: {
			responses: { 200: { content: { 'application/json': { id: string } } } };
		};
	};
}

function memoryStore(initial: string | null): TokenStore & { token: string | null } {
	const state = { token: initial };
	return {
		get token() {
			return state.token;
		},
		getToken: () => state.token,
		setToken: (value: string | null) => {
			state.token = value;
		},
	};
}

describe('authMiddleware — request decoration', () => {
	it('attaches the bearer token to outgoing requests', async () => {
		let seenAuth: string | null = null;
		const fetch: typeof globalThis.fetch = async (input) => {
			const request = input as Request;
			seenAuth = request.headers.get('authorization');
			return new Response(JSON.stringify({ id: 'u1' }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			});
		};
		const store = memoryStore('tok-1');
		const api = createClient<Paths>({
			baseUrl: 'https://api.test',
			fetch,
			middlewares: [authMiddleware({ store, refresh: () => 'unused' })],
		});
		const { data } = await api.GET('/me');
		expect(data).toEqual({ id: 'u1' });
		expect(seenAuth).toBe('Bearer tok-1');
	});

	it('sends no Authorization header when unauthenticated', async () => {
		let hasAuth = true;
		const fetch: typeof globalThis.fetch = async (input) => {
			hasAuth = (input as Request).headers.has('authorization');
			return new Response(JSON.stringify({ id: 'anon' }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			});
		};
		const store = memoryStore(null);
		const api = createClient<Paths>({
			baseUrl: 'https://api.test',
			fetch,
			middlewares: [authMiddleware({ store, refresh: () => 'x' })],
		});
		await api.GET('/me');
		expect(hasAuth).toBe(false);
	});

	it('honours a custom header and scheme', async () => {
		let seen: string | null = null;
		const fetch: typeof globalThis.fetch = async (input) => {
			seen = (input as Request).headers.get('x-api-key');
			return new Response(JSON.stringify({ id: 'u' }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			});
		};
		const store = memoryStore('raw-key');
		const api = createClient<Paths>({
			baseUrl: 'https://api.test',
			fetch,
			middlewares: [authMiddleware({ store, refresh: () => 'x', header: 'X-Api-Key', scheme: '' })],
		});
		await api.GET('/me');
		expect(seen).toBe('raw-key');
	});
});

describe('authMiddleware — refresh on 401 + retry', () => {
	it('refreshes the token and retries the request once', async () => {
		const tokens: Array<string | null> = [];
		const fetch: typeof globalThis.fetch = async (input) => {
			const auth = (input as Request).headers.get('authorization');
			tokens.push(auth);
			if (auth === 'Bearer expired') {
				return new Response(JSON.stringify({ status: 401 }), {
					status: 401,
					headers: { 'content-type': 'application/problem+json' },
				});
			}
			return new Response(JSON.stringify({ id: 'u9' }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			});
		};
		const store = memoryStore('expired');
		const refresh = vi.fn(() => 'fresh');
		const api = createClient<Paths>({
			baseUrl: 'https://api.test',
			fetch,
			middlewares: [authMiddleware({ store, refresh })],
		});
		const { data } = await api.GET('/me');
		expect(refresh).toHaveBeenCalledOnce();
		expect(store.token).toBe('fresh');
		expect(tokens).toEqual(['Bearer expired', 'Bearer fresh']);
		expect(data).toEqual({ id: 'u9' });
	});

	it('does not loop when the retry also returns 401 (throws ProblemError once)', async () => {
		let calls = 0;
		const fetch: typeof globalThis.fetch = async () => {
			calls += 1;
			return new Response(JSON.stringify({ type: 'x', title: 'Nope', status: 401 }), {
				status: 401,
				headers: { 'content-type': 'application/problem+json' },
			});
		};
		const store = memoryStore('expired');
		const refresh = vi.fn(() => 'still-bad');
		const api = createClient<Paths>({
			baseUrl: 'https://api.test',
			fetch,
			// problemMiddleware is applied first by createClient, so the final 401 throws.
			middlewares: [authMiddleware({ store, refresh })],
		});
		await expect(api.GET('/me')).rejects.toBeInstanceOf(ProblemError);
		expect(refresh).toHaveBeenCalledOnce();
		expect(calls).toBe(2); // original + one retry, no loop
	});

	it('maps a thrown refresh failure to ProblemError', async () => {
		const fetch: typeof globalThis.fetch = async () =>
			new Response('{}', {
				status: 401,
				headers: { 'content-type': 'application/problem+json' },
			});
		const store = memoryStore('expired');
		const refresh = vi.fn(() => {
			throw new Error('network down');
		});
		const api = createClient<Paths>({
			baseUrl: 'https://api.test',
			fetch,
			problem: false, // isolate the auth middleware's own ProblemError
			middlewares: [authMiddleware({ store, refresh })],
		});
		await expect(api.GET('/me')).rejects.toMatchObject({
			name: 'ProblemError',
			type: 'https://sveltesentio.dev/problems/auth/refresh-failed',
			status: 401,
		});
	});

	it('maps a null-token refresh (unrecoverable session) to ProblemError', async () => {
		const fetch: typeof globalThis.fetch = async () =>
			new Response('{}', {
				status: 401,
				headers: { 'content-type': 'application/problem+json' },
			});
		const store = memoryStore('expired');
		const refresh = vi.fn(() => null);
		const api = createClient<Paths>({
			baseUrl: 'https://api.test',
			fetch,
			problem: false,
			middlewares: [authMiddleware({ store, refresh })],
		});
		const error = await api.GET('/me').then(
			() => undefined,
			(e: unknown) => e,
		);
		expect(error).toBeInstanceOf(ProblemError);
		expect((error as ProblemError).status).toBe(401);
	});

	it('leaves non-refresh statuses untouched', async () => {
		const refresh = vi.fn(() => 'fresh');
		const fetch: typeof globalThis.fetch = async () =>
			new Response(JSON.stringify({ id: 'u' }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			});
		const store = memoryStore('tok');
		const api = createClient<Paths>({
			baseUrl: 'https://api.test',
			fetch,
			middlewares: [authMiddleware({ store, refresh, refreshOn: [419] })],
		});
		await api.GET('/me');
		expect(refresh).not.toHaveBeenCalled();
	});
});
