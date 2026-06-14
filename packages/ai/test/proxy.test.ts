import { describe, expect, it, vi } from 'vitest';
import { ProblemError } from '@sveltesentio/core';
import { createLlmProxy, type FetchLike } from '../src/proxy.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' },
		...init,
	});
}

describe('createLlmProxy', () => {
	it('POSTs a chat request to the app-owned endpoint and returns the parsed body', async () => {
		const fetchImpl: FetchLike = vi.fn(async () =>
			jsonResponse({ reply: 'hello there' }),
		);
		const proxy = createLlmProxy({ endpoint: '/api/ai/chat', fetch: fetchImpl });

		const result = await proxy.chat<{ reply: string }>({
			messages: [{ role: 'user', content: 'hi' }],
		});

		expect(result).toEqual({ reply: 'hello there' });
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } })
			.mock.calls[0]!;
		expect(url).toBe('/api/ai/chat');
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body as string)).toEqual({
			messages: [{ role: 'user', content: 'hi' }],
		});
	});

	it('merges custom headers and never targets a provider URL', async () => {
		let seenHeaders: Record<string, string> = {};
		const fetchImpl: FetchLike = async (_url, init) => {
			seenHeaders = (init?.headers ?? {}) as Record<string, string>;
			return jsonResponse({ ok: true });
		};
		const proxy = createLlmProxy({
			endpoint: '/api/ai/complete',
			fetch: fetchImpl,
			headers: { 'x-csrf-token': 'abc' },
		});
		await proxy.complete({ prompt: 'finish this' });
		expect(seenHeaders['x-csrf-token']).toBe('abc');
		expect(seenHeaders['content-type']).toBe('application/json');
	});

	it('throws a ProblemError parsed from an RFC 9457 problem+json body', async () => {
		const fetchImpl: FetchLike = async () =>
			new Response(
				JSON.stringify({
					type: 'https://errors.example/rate-limited',
					title: 'Too Many Requests',
					status: 429,
					detail: 'Slow down.',
				}),
				{
					status: 429,
					headers: { 'content-type': 'application/problem+json' },
				},
			);
		const proxy = createLlmProxy({ endpoint: '/api/ai/chat', fetch: fetchImpl });

		await expect(
			proxy.chat({ messages: [{ role: 'user', content: 'x' }] }),
		).rejects.toMatchObject({
			name: 'ProblemError',
			type: 'https://errors.example/rate-limited',
			status: 429,
			detail: 'Slow down.',
		});
	});

	it('throws a generic ProblemError on a non-problem non-2xx response', async () => {
		const fetchImpl: FetchLike = async () =>
			new Response('upstream exploded', {
				status: 502,
				statusText: 'Bad Gateway',
				headers: { 'content-type': 'text/plain' },
			});
		const proxy = createLlmProxy({ endpoint: '/api/ai/chat', fetch: fetchImpl });

		const error = await proxy
			.complete({ prompt: 'x' })
			.then(() => undefined)
			.catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ProblemError);
		if (error instanceof ProblemError) {
			expect(error.status).toBe(502);
			expect(error.detail).toBe('upstream exploded');
			expect(error.extensions.endpoint).toBe('/api/ai/chat');
		}
	});

	it('forwards an abort signal to fetch', async () => {
		const controller = new AbortController();
		let seenSignal: AbortSignal | undefined;
		const fetchImpl: FetchLike = async (_url, init) => {
			seenSignal = init?.signal;
			return jsonResponse({ ok: true });
		};
		const proxy = createLlmProxy({ endpoint: '/api/ai/chat', fetch: fetchImpl });
		await proxy.chat({ messages: [] }, { signal: controller.signal });
		expect(seenSignal).toBe(controller.signal);
	});

	it('returns a text body when the success response is not JSON', async () => {
		const fetchImpl: FetchLike = async () =>
			new Response('plain reply', {
				status: 200,
				headers: { 'content-type': 'text/plain' },
			});
		const proxy = createLlmProxy({ endpoint: '/api/ai/complete', fetch: fetchImpl });
		const result = await proxy.complete<string>({ prompt: 'hi' });
		expect(result).toBe('plain reply');
	});

	it('falls back to global fetch when none is injected', async () => {
		const original = globalThis.fetch;
		const spy = vi.fn(async () => jsonResponse({ via: 'global' }));
		(globalThis as { fetch: unknown }).fetch = spy;
		try {
			const proxy = createLlmProxy({ endpoint: '/api/ai/chat' });
			const result = await proxy.chat<{ via: string }>({ messages: [] });
			expect(result).toEqual({ via: 'global' });
			expect(spy).toHaveBeenCalledTimes(1);
		} finally {
			(globalThis as { fetch: unknown }).fetch = original;
		}
	});

	it('throws a ProblemError at construction when no fetch is available', () => {
		const original = globalThis.fetch;
		(globalThis as { fetch: unknown }).fetch = undefined;
		try {
			expect(() => createLlmProxy({ endpoint: '/api/ai/chat' })).toThrow(ProblemError);
		} finally {
			(globalThis as { fetch: unknown }).fetch = original;
		}
	});
});
