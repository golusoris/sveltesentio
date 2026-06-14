import { describe, expect, it } from 'vitest';
import { ProblemError } from '@sveltesentio/core';
import { problemToFieldErrors } from '../src/problem-to-field-errors.js';

describe('problemToFieldErrors', () => {
	it('maps invalid-params entries into per-field arrays', () => {
		const error = new ProblemError({
			type: 'https://example.com/validation',
			title: 'Validation failed',
			status: 422,
			invalidParams: [
				{ name: 'email', reason: 'must be a valid email' },
				{ name: 'password', reason: 'too short' },
			],
		});
		const errors = problemToFieldErrors(error);
		expect(errors).toEqual({
			email: ['must be a valid email'],
			password: ['too short'],
		});
	});

	it('aggregates multiple reasons for the same field', () => {
		const error = new ProblemError({
			type: 'about:blank',
			status: 422,
			invalidParams: [
				{ name: 'password', reason: 'too short' },
				{ name: 'password', reason: 'missing a digit' },
			],
		});
		expect(problemToFieldErrors(error)).toEqual({
			password: ['too short', 'missing a digit'],
		});
	});

	it('returns empty map when invalid-params is absent', () => {
		const error = new ProblemError({
			type: 'about:blank',
			status: 500,
			title: 'Server error',
		});
		expect(problemToFieldErrors(error)).toEqual({});
	});
});
