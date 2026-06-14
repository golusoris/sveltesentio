import { describe, it, expect } from 'vitest';
import { ProblemError } from '@sveltesentio/core';
import { createClient } from '../src/client.js';

interface Paths {
	'/thing': {
		get: {
			responses: { 200: { content: { 'application/json': { ok: boolean } } } };
		};
	};
}

describe('createClient + problemMiddleware', () => {
	it('throws core ProblemError on application/problem+json', async () => {
		const fetch: typeof globalThis.fetch = async () =>
			new Response(JSON.stringify({ type: 'https://err/forbidden', title: 'Nope', status: 403 }), {
				status: 403,
				headers: { 'content-type': 'application/problem+json' },
			});
		const api = createClient<Paths>({ baseUrl: 'https://api.test', fetch });
		await expect(api.GET('/thing')).rejects.toBeInstanceOf(ProblemError);
	});

	it('returns data on a successful response', async () => {
		const fetch: typeof globalThis.fetch = async () =>
			new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			});
		const api = createClient<Paths>({ baseUrl: 'https://api.test', fetch });
		const { data } = await api.GET('/thing');
		expect(data).toEqual({ ok: true });
	});

	it('skips the problem middleware when problem: false', async () => {
		const fetch: typeof globalThis.fetch = async () =>
			new Response(JSON.stringify({ type: 'x', status: 500 }), {
				status: 500,
				headers: { 'content-type': 'application/problem+json' },
			});
		const api = createClient<Paths>({ baseUrl: 'https://api.test', fetch, problem: false });
		const { error } = await api.GET('/thing');
		expect(error).toBeDefined(); // surfaced as data/error, not thrown
	});
});
