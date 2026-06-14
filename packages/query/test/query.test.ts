import { describe, it, expect } from 'vitest';
import { ProblemError } from '@sveltesentio/core';
import { isRetryableProblem } from '../src/retry.js';

describe('isRetryableProblem (RFC 9457 retry policy)', () => {
	it('does not retry typed 4xx client errors', () => {
		expect(isRetryableProblem(new ProblemError({ type: 'about:blank', status: 404 }))).toBe(false);
		expect(isRetryableProblem(new ProblemError({ type: 'about:blank', status: 400 }))).toBe(false);
		expect(isRetryableProblem(new ProblemError({ type: 'about:blank', status: 422 }))).toBe(false);
	});

	it('retries 429 and 5xx', () => {
		expect(isRetryableProblem(new ProblemError({ type: 'x', status: 429 }))).toBe(true);
		expect(isRetryableProblem(new ProblemError({ type: 'x', status: 500 }))).toBe(true);
		expect(isRetryableProblem(new ProblemError({ type: 'x', status: 503 }))).toBe(true);
	});

	it('retries unknown-status problems and non-Problem (network) errors', () => {
		expect(isRetryableProblem(new ProblemError({ type: 'x' }))).toBe(true);
		expect(isRetryableProblem(new Error('network down'))).toBe(true);
	});
});
