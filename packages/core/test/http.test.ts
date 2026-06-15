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

	it('uses "Problem parse failure" title when statusText is empty on a JSON parse error', async () => {
		const mw = problemMiddleware();
		// Empty statusText forces the `||` fallback on the parse-failure branch.
		const r = new Response('not-json{', {
			status: 502,
			statusText: '',
			headers: { 'content-type': 'application/problem+json' },
		});
		await expect(call(mw, r)).rejects.toMatchObject({
			type: 'about:blank',
			status: 502,
			title: 'Problem parse failure',
		});
	});

	it('preserves the JSON parse error as the thrown ProblemError cause', async () => {
		const mw = problemMiddleware();
		const r = new Response('}{', {
			status: 500,
			headers: { 'content-type': 'application/problem+json' },
		});
		await expect(call(mw, r)).rejects.toSatisfy(
			(err) => err instanceof ProblemError && err.cause instanceof Error,
		);
	});

	it('uses the parsed string body as detail when the body is a JSON string but not a problem doc', async () => {
		const mw = problemMiddleware();
		// Valid JSON that parses (to the string "plain message") but is not a
		// problem document → unknown-problem fallback with string detail.
		const r = new Response(JSON.stringify('plain message'), {
			status: 400,
			statusText: 'Bad Request',
			headers: { 'content-type': 'application/problem+json' },
		});
		await expect(call(mw, r)).rejects.toMatchObject({
			type: 'about:blank',
			status: 400,
			title: 'Bad Request',
			detail: 'plain message',
		});
	});

	it('uses "Unknown problem" title and undefined detail for a non-string non-problem JSON body', async () => {
		const mw = problemMiddleware();
		// A JSON array parses but is not a problem doc and is not a string.
		const r = new Response(JSON.stringify([1, 2, 3]), {
			status: 503,
			statusText: '',
			headers: { 'content-type': 'application/problem+json' },
		});
		await expect(call(mw, r)).rejects.toMatchObject({
			type: 'about:blank',
			status: 503,
			title: 'Unknown problem',
			detail: undefined,
		});
	});
});
