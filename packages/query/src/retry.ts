import { ProblemError } from '@sveltesentio/core';

/**
 * Whether a failure is worth retrying. RFC 9457-aware: a typed `ProblemError`
 * with a 4xx status (except 429) is a client error and is never retried;
 * 5xx / 429 / unknown-status / non-Problem (network, parse) failures are.
 *
 * Kept dependency-free (no `@tanstack/svelte-query` import) so it is unit-testable
 * without the Svelte component runtime.
 */
export function isRetryableProblem(error: unknown): boolean {
	if (error instanceof ProblemError) {
		if (error.status === undefined) return true;
		if (error.status === 429) return true;
		return error.status >= 500;
	}
	return true;
}
