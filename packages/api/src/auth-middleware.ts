// openapi-fetch Middleware preset: attach a bearer token on every request and,
// on a 401, refresh the token once and retry the original request. The token
// store + refresh fn are injected so this composes with any session strategy
// (@sveltesentio/auth, cookies, in-memory). Refresh failures map to ProblemError.
import type { Middleware, MiddlewareCallbackParams } from 'openapi-fetch';
import { ProblemError } from '@sveltesentio/core/http';

/** Pluggable token storage. Sync or async; backed by memory, cookies, IndexedDB, … */
export interface TokenStore {
	/** Current access token, or `undefined`/`null` when unauthenticated. */
	getToken: () => string | null | undefined | Promise<string | null | undefined>;
	/** Persist a freshly minted access token. Called after a successful refresh. */
	setToken: (token: string | null) => void | Promise<void>;
}

export interface AuthMiddlewareOptions {
	/** Where the access token is read from / written to. */
	store: TokenStore;
	/**
	 * Mint a new access token (e.g. POST /auth/refresh). Resolve with the new
	 * token, or `null`/`undefined` if the session is unrecoverable (→ ProblemError).
	 */
	refresh: () => string | null | undefined | Promise<string | null | undefined>;
	/** HTTP header to carry the token. Default `Authorization`. */
	header?: string;
	/** Token scheme prefix. Default `Bearer `; pass `''` for a raw token. */
	scheme?: string;
	/** Status codes that trigger a refresh. Default `[401]`. */
	refreshOn?: readonly number[];
}

const DEFAULT_HEADER = 'Authorization';
const DEFAULT_SCHEME = 'Bearer ';
const DEFAULT_REFRESH_ON: readonly number[] = [401];

// Re-fetching consumes the body, so a 401-with-the-same-token loop would spin
// forever. This symbol marks a request we already retried; a second 401 falls
// through to the caller untouched.
const RETRIED = Symbol('sveltesentio.auth.retried');

interface RetryState {
	[RETRIED]?: true;
}

function applyToken(request: Request, header: string, scheme: string, token: string): Request {
	const next = request.clone();
	next.headers.set(header, scheme + token);
	return next;
}

function problemFromRefreshFailure(status: number, cause?: unknown): ProblemError {
	return new ProblemError({
		type: 'https://sveltesentio.dev/problems/auth/refresh-failed',
		title: 'Token refresh failed',
		status,
		detail: 'The access token could not be refreshed; re-authentication is required.',
		cause,
	});
}

/**
 * Build the auth middleware. Add it AFTER `problemMiddleware` so a retried-but-
 * still-failing response is normalised to a `ProblemError` by the outer middleware.
 *
 * ```ts
 * const api = createClient<paths>({
 * 	baseUrl,
 * 	middlewares: [authMiddleware({ store, refresh })],
 * });
 * ```
 */
export function authMiddleware(options: AuthMiddlewareOptions): Middleware {
	const header = options.header ?? DEFAULT_HEADER;
	const scheme = options.scheme ?? DEFAULT_SCHEME;
	const refreshOn = options.refreshOn ?? DEFAULT_REFRESH_ON;
	const { store, refresh } = options;

	return {
		onRequest: async ({ request }: MiddlewareCallbackParams) => {
			const token = await store.getToken();
			if (token == null || token === '') return undefined;
			return applyToken(request, header, scheme, token);
		},

		onResponse: async ({ request, response, options: clientOptions }) => {
			if (!refreshOn.includes(response.status)) return undefined;
			if ((request as Request & RetryState)[RETRIED]) return undefined;

			let nextToken: string | null | undefined;
			try {
				nextToken = await refresh();
			} catch (cause) {
				throw problemFromRefreshFailure(response.status, cause);
			}
			if (nextToken == null || nextToken === '') {
				throw problemFromRefreshFailure(response.status);
			}

			await store.setToken(nextToken);

			const retried = applyToken(request, header, scheme, nextToken) as Request & RetryState;
			retried[RETRIED] = true;
			return clientOptions.fetch(retried);
		},
	};
}
