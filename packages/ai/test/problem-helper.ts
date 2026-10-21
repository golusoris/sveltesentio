import { expect } from 'vitest';
import { ProblemError } from '@sveltesentio/core';

/**
 * Asserts that the promise rejects with a `ProblemError` and returns it.
 */
export async function expectProblemError(promise: Promise<unknown>): Promise<ProblemError> {
	const error = await promise.then(() => undefined).catch((e: unknown) => e);
	expect(error).toBeInstanceOf(ProblemError);
	if (!(error instanceof ProblemError)) {
		throw new Error('Expected ProblemError');
	}
	return error;
}
