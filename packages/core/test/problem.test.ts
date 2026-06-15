import { describe, expect, it } from 'vitest';
import {
	ProblemError,
	isProblemResponse,
	parseProblem,
	problemFromDocument,
	problemFromResponse,
} from '../src/problem';

describe('parseProblem', () => {
	it('returns the parsed document on success', () => {
		const doc = parseProblem({
			type: 'https://example.com/probs/out-of-credit',
			title: 'You do not have enough credit.',
			status: 403,
			detail: 'Your current balance is 30, but that costs 50.',
			instance: '/account/12345/msgs/abc',
			balance: 30,
		});
		expect(doc?.status).toBe(403);
		expect((doc as { balance?: number }).balance).toBe(30);
	});

	it('defaults type to about:blank', () => {
		const doc = parseProblem({ title: 'x' });
		expect(doc?.type).toBe('about:blank');
	});

	it('returns undefined on non-object input', () => {
		expect(parseProblem('nope')).toBeUndefined();
	});
});

describe('ProblemError', () => {
	it('uses detail as message when present', () => {
		const err = problemFromDocument({
			type: 'about:blank',
			title: 'Forbidden',
			status: 403,
			detail: 'Cannot.',
		});
		expect(err).toBeInstanceOf(ProblemError);
		expect(err.message).toBe('Cannot.');
		expect(err.status).toBe(403);
	});

	it('preserves unknown extensions', () => {
		const err = problemFromDocument({
			type: 'about:blank',
			status: 400,
			detail: 'x',
			balance: 30,
		} as never);
		expect(err.extensions['balance']).toBe(30);
	});

	it('synthesises a message from type + status when no detail or title', () => {
		const err = new ProblemError({ type: 'about:blank', status: 404 });
		expect(err.message).toBe('Problem: about:blank (404)');
	});

	it('uses "?" for the status placeholder when status is also absent', () => {
		const err = new ProblemError({ type: 'https://errs/x' });
		expect(err.message).toBe('Problem: https://errs/x (?)');
	});

	it('falls back to title for the message when detail is absent', () => {
		const err = new ProblemError({ type: 'about:blank', title: 'Just a title' });
		expect(err.message).toBe('Just a title');
	});

	it('omits undefined optional fields from toJSON', () => {
		const err = new ProblemError({ type: 'about:blank' });
		const doc = err.toJSON();
		expect(doc).toEqual({ type: 'about:blank' });
		expect('title' in doc).toBe(false);
		expect('status' in doc).toBe(false);
		expect('detail' in doc).toBe(false);
		expect('instance' in doc).toBe(false);
		expect('invalid-params' in doc).toBe(false);
	});

	it('defaults extensions to an empty object when none provided', () => {
		const err = new ProblemError({ type: 'about:blank' });
		expect(err.extensions).toEqual({});
	});

	it('threads cause through the Error constructor', () => {
		const cause = new Error('underlying');
		const err = new ProblemError({ type: 'about:blank', cause });
		expect(err.cause).toBe(cause);
	});

	it('round-trips through toJSON', () => {
		const err = new ProblemError({
			type: 'about:blank',
			title: 'T',
			status: 418,
			detail: 'I am a teapot',
			invalidParams: [{ name: 'pot', reason: 'too short' }],
			extensions: { teapot: true },
		});
		const doc = err.toJSON();
		expect(doc.status).toBe(418);
		expect(doc['invalid-params']).toEqual([{ name: 'pot', reason: 'too short' }]);
		expect((doc as { teapot?: boolean }).teapot).toBe(true);
	});
});

describe('isProblemResponse', () => {
	it('detects problem+json content-type', () => {
		const r = new Response('{}', {
			status: 400,
			headers: { 'content-type': 'application/problem+json; charset=utf-8' },
		});
		expect(isProblemResponse(r)).toBe(true);
	});

	it('rejects other content-types', () => {
		const r = new Response('{}', {
			status: 400,
			headers: { 'content-type': 'application/json' },
		});
		expect(isProblemResponse(r)).toBe(false);
	});
});

describe('problemFromResponse', () => {
	it('falls back to about:blank on non-problem body', () => {
		const r = new Response('oops', { status: 500, statusText: 'Boom' });
		const err = problemFromResponse(r, 'oops');
		expect(err.type).toBe('about:blank');
		expect(err.status).toBe(500);
		expect(err.detail).toBe('oops');
	});

	it('uses the response statusText fallback "HTTP error" when statusText is empty', () => {
		// A non-object body is rejected by parseProblem → fallback branch.
		const r = new Response('oops', { status: 500, statusText: '' });
		const err = problemFromResponse(r, ['not', 'a', 'problem', 'doc']);
		expect(err.title).toBe('HTTP error');
		expect(err.detail).toBeUndefined();
	});

	it('builds from a valid problem document body and threads the cause', () => {
		const r = new Response('{}', { status: 403, statusText: 'Forbidden' });
		const cause = new Error('network');
		const err = problemFromResponse(
			r,
			{
				type: 'https://errs/forbidden',
				title: 'Forbidden',
				status: 403,
				detail: 'no access',
			},
			cause,
		);
		expect(err.type).toBe('https://errs/forbidden');
		expect(err.detail).toBe('no access');
		expect(err.cause).toBe(cause);
	});
});

describe('problemFromDocument extras', () => {
	it('maps invalid-params, instance and extension fields', () => {
		const err = problemFromDocument({
			type: 'https://errs/validation',
			title: 'Validation failed',
			status: 422,
			instance: '/orders/42',
			'invalid-params': [{ name: 'qty', reason: 'must be positive' }],
			traceId: 'abc-123',
		} as never);
		expect(err.instance).toBe('/orders/42');
		expect(err.invalidParams).toEqual([{ name: 'qty', reason: 'must be positive' }]);
		expect(err.extensions['traceId']).toBe('abc-123');
	});
});
