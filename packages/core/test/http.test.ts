import { describe, expect, it } from 'vitest';
import { ProblemError, problemMiddleware } from '../src/http';

function call(
	middleware: ReturnType<typeof problemMiddleware>,
	response: Response,
): Promise<unknown> {
	const onResponse = middleware.onResponse;
	if (!onResponse) throw new Error('middleware has no onResponse');
	return Promise.resolve(
		onResponse({
			response,
			request: new Request('https://example.test'),
			schemaPath: '/',
			params: {},
			id: 'test',
			options: {} as never,
		} as never),
	);
}

describe('problemMiddleware', () => {
	it('passes through OK responses', async () => {
		const mw = problemMiddleware();
		const r = new Response('{}', { status: 200 });
		await expect(call(mw, r)).resolves.toBeUndefined();
	});

	it('passes through non-problem error responses', async () => {
		const mw = problemMiddleware();
		const r = new Response('boom', {
			status: 500,
			headers: { 'content-type': 'text/plain' },
		});
		await expect(call(mw, r)).resolves.toBeUndefined();
	});

	it('throws ProblemError on problem+json responses', async () => {
		const mw = problemMiddleware();
		const body = JSON.stringify({
			type: 'https://example.test/out-of-credit',
			title: 'Out of credit',
			status: 403,
			detail: 'balance too low',
		});
		const r = new Response(body, {
			status: 403,
			headers: { 'content-type': 'application/problem+json' },
		});
		await expect(call(mw, r)).rejects.toBeInstanceOf(ProblemError);
	});

	it('invokes onProblem hook before throwing', async () => {
		let seen: ProblemError | undefined;
		const mw = problemMiddleware({
			onProblem: (err) => {
				seen = err;
			},
		});
		const r = new Response(JSON.stringify({ type: 'about:blank', status: 418 }), {
			status: 418,
			headers: { 'content-type': 'application/problem+json' },
		});
		await expect(call(mw, r)).rejects.toBeInstanceOf(ProblemError);
		expect(seen?.status).toBe(418);
	});

	it('falls back to about:blank on invalid problem body', async () => {
		const mw = problemMiddleware();
		const r = new Response('not-json', {
			status: 500,
			statusText: 'Server Error',
			headers: { 'content-type': 'application/problem+json' },
		});
		await expect(call(mw, r)).rejects.toMatchObject({
			type: 'about:blank',
			status: 500,
		});
	});
});
