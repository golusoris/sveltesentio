import type { Middleware } from 'openapi-fetch';
import {
	ProblemError,
	isProblemResponse,
	parseProblem,
	problemFromDocument,
} from './problem.js';

export { ProblemError } from './problem.js';
export type { ProblemDocument, ProblemErrorInit, InvalidParam } from './problem.js';

export interface ProblemMiddlewareOptions {
	onProblem?: (error: ProblemError) => void;
}

export function problemMiddleware(options: ProblemMiddlewareOptions = {}): Middleware {
	return {
		onResponse: async ({ response }) => {
			if (response.ok) return undefined;
			if (!isProblemResponse(response)) return undefined;

			const clone = response.clone();
			let body: unknown;
			try {
				body = await clone.json();
			} catch (cause) {
				throw new ProblemError({
					type: 'about:blank',
					title: response.statusText || 'Problem parse failure',
					status: response.status,
					cause,
				});
			}

			const parsed = parseProblem(body);
			const error = parsed
				? problemFromDocument(parsed)
				: new ProblemError({
						type: 'about:blank',
						title: response.statusText || 'Unknown problem',
						status: response.status,
						detail: typeof body === 'string' ? body : undefined,
					});

			options.onProblem?.(error);
			throw error;
		},
	};
}
