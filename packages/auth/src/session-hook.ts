import type { Handle } from '@sveltejs/kit';
import { ProblemError } from '@sveltesentio/core';
import { SESSION_COOKIE_NAME } from './cookies.js';

/**
 * Resolves a raw session token into the application session object (or `null`
 * when the token is absent/expired/revoked). Injected so the hook unit-tests
 * without a real Golusoris instance and so the cookie→`locals` wiring is the
 * single source of truth across apps.
 *
 * Per ADR-0034 the token is opaque to the client: the server (Golusoris) owns
 * validation. The resolver is the server-side lookup — never `localStorage`,
 * which is the revenge antipattern this migration remediates
 * (docs/migrations/downstream-antipatterns-v0.1.md, row 1).
 */
export type SessionResolver<Session> = (token: string) => Promise<Session | null>;

/** Minimal event shape {@link resolveSessionLocals} reads — a subset of SvelteKit's `RequestEvent`. */
export interface SessionEvent<Session> {
	cookies: { get(name: string): string | undefined };
	locals: { session?: Session | null };
}

export interface HandleSessionOptions<Session> {
	/** Resolves a cookie token into a session (or `null`). Typically a cookie-bearing request to Golusoris. */
	resolve: SessionResolver<Session>;
	/** Cookie name holding the session token. Defaults to `__Host-session`. */
	cookieName?: string;
	/** Property on `event.locals` to populate. Defaults to `'session'`. */
	localsKey?: string;
	/**
	 * How to treat a `resolve` that throws. `'passthrough'` (default) swallows the
	 * error, leaves `locals.<key>` as `null`, and continues the request as
	 * unauthenticated. `'rethrow'` lets the error propagate (e.g. to a SvelteKit
	 * `handleError`). A {@link ProblemError} is always rethrown verbatim regardless
	 * of this setting, so RFC 9457 problem documents reach the client unchanged.
	 */
	onResolveError?: 'passthrough' | 'rethrow';
}

/**
 * Reads the session cookie off the event, resolves it, and writes the result to
 * `event.locals[localsKey]`. Pure aside from the injected `resolve`; exposed for
 * direct unit testing without a SvelteKit runtime.
 *
 * - Cookie absent → `locals[key] = null`, resolver not called.
 * - Cookie present → `locals[key] = await resolve(token)` (which may be `null`).
 * - Resolver throws a {@link ProblemError} → always rethrown.
 * - Resolver throws otherwise → rethrown when `onResolveError === 'rethrow'`,
 *   else `locals[key] = null`.
 */
export async function resolveSessionLocals<Session>(
	event: SessionEvent<Session>,
	options: HandleSessionOptions<Session>,
): Promise<void> {
	const cookieName = options.cookieName ?? SESSION_COOKIE_NAME;
	const localsKey = options.localsKey ?? 'session';
	const locals = event.locals as Record<string, Session | null>;

	const token = event.cookies.get(cookieName);
	if (!token) {
		locals[localsKey] = null;
		return;
	}

	try {
		locals[localsKey] = await options.resolve(token);
	} catch (error) {
		if (error instanceof ProblemError) throw error;
		if (options.onResolveError === 'rethrow') throw error;
		locals[localsKey] = null;
	}
}

/**
 * SvelteKit `Handle` that hydrates `event.locals.session` from the
 * `__Host-session` cookie before downstream `load` / endpoints run. Compose it
 * ahead of {@link handleCsrf} via `@sveltejs/kit` `sequence()` so CSRF's
 * `getContext` can read the resolved session:
 *
 * ```ts
 * // hooks.server.ts
 * import { sequence } from '@sveltejs/kit/hooks';
 * import { handleSession, handleCsrf } from '@sveltesentio/auth';
 *
 * export const handle = sequence(
 * 	handleSession({ resolve: (token) => api.resolveSession(token) }),
 * 	handleCsrf({ getContext: (event) => buildCsrfContext(event.locals.session) }),
 * );
 * ```
 */
export function handleSession<Session>(options: HandleSessionOptions<Session>): Handle {
	return async ({ event, resolve }) => {
		await resolveSessionLocals(event as unknown as SessionEvent<Session>, options);
		return resolve(event);
	};
}
