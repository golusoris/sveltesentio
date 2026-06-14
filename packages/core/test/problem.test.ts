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
});
