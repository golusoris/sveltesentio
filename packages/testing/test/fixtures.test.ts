import { describe, it, expect } from 'vitest';
import { ProblemError } from '@sveltesentio/core';
import {
	authProblem,
	forbiddenProblem,
	notFoundProblem,
	problemError,
	problemResponse,
	rateLimitedProblem,
	serverErrorProblem,
	validationProblem,
} from '../src/fixtures';

describe('problemError', () => {
	it('returns a ProblemError instance with the given init', () => {
		const err = problemError({ type: 'about:blank', status: 400 });
		expect(err).toBeInstanceOf(ProblemError);
		expect(err.status).toBe(400);
	});
});

describe('validationProblem', () => {
	it('maps single-string field reasons to one invalid-param', () => {
		const err = validationProblem({ fields: { email: 'must be email' } });
		expect(err.status).toBe(422);
		expect(err.invalidParams).toEqual([
			{ name: 'email', reason: 'must be email' },
		]);
	});

	it('maps array reasons to one invalid-param per reason', () => {
		const err = validationProblem({
			fields: { password: ['too short', 'too common'] },
		});
		expect(err.invalidParams).toEqual([
			{ name: 'password', reason: 'too short' },
			{ name: 'password', reason: 'too common' },
		]);
	});

	it('emits the golusoris validation type by default', () => {
		const err = validationProblem({ fields: { x: 'y' } });
		expect(err.type).toBe('https://golusoris.dev/problems/validation');
		expect(err.title).toBe('Validation failed');
	});

	it('respects type / status / detail overrides', () => {
		const err = validationProblem({
			fields: { x: 'y' },
			type: 'urn:custom',
			status: 400,
			detail: 'Custom detail',
		});
		expect(err.type).toBe('urn:custom');
		expect(err.status).toBe(400);
		expect(err.detail).toBe('Custom detail');
	});
});

describe('authProblem', () => {
	it('defaults to 401 + golusoris unauth type', () => {
		const err = authProblem();
		expect(err.status).toBe(401);
		expect(err.type).toBe('https://golusoris.dev/problems/unauthenticated');
	});
});

describe('forbiddenProblem', () => {
	it('defaults to 403', () => {
		expect(forbiddenProblem().status).toBe(403);
	});
});

describe('notFoundProblem', () => {
	it('defaults to 404', () => {
		expect(notFoundProblem().status).toBe(404);
	});
});

describe('rateLimitedProblem', () => {
	it('defaults to 429', () => {
		expect(rateLimitedProblem().status).toBe(429);
	});

	it('sets retry-after extension when provided', () => {
		const err = rateLimitedProblem({ retryAfterSeconds: 30 });
		expect(err.extensions['retry-after']).toBe(30);
	});

	it('preserves other extensions when retryAfterSeconds also given', () => {
		const err = rateLimitedProblem({
			retryAfterSeconds: 5,
			extensions: { quota: 'free-tier' },
		});
		expect(err.extensions).toEqual({ quota: 'free-tier', 'retry-after': 5 });
	});
});

describe('serverErrorProblem', () => {
	it('defaults to 500 about:blank', () => {
		const err = serverErrorProblem();
		expect(err.status).toBe(500);
		expect(err.type).toBe('about:blank');
	});
});

describe('problemResponse', () => {
	it('serialises to a Response with problem+json content-type', async () => {
		const err = validationProblem({ fields: { name: 'required' } });
		const res = problemResponse(err);
		expect(res.status).toBe(422);
		expect(res.headers.get('content-type')).toBe('application/problem+json');
		const body = (await res.json()) as Record<string, unknown>;
		expect(body['type']).toBe('https://golusoris.dev/problems/validation');
		expect(body['invalid-params']).toEqual([{ name: 'name', reason: 'required' }]);
	});

	it('falls back to status 500 when error has no status', () => {
		const err = problemError({ type: 'about:blank' });
		expect(problemResponse(err).status).toBe(500);
	});

	it('respects extra headers', () => {
		const err = authProblem();
		const res = problemResponse(err, { headers: { 'www-authenticate': 'Bearer' } });
		expect(res.headers.get('www-authenticate')).toBe('Bearer');
	});
});
