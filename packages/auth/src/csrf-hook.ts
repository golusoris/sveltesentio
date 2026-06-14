import type { Handle, RequestEvent } from '@sveltejs/kit';
import { CSRF_COOKIE_NAME } from './cookies.js';
import { verifyCsrfToken } from './csrf.js';

/** HTTP methods that mutate state and therefore require a valid CSRF token. */
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Header carrying the double-submit token on fetch/XHR mutations. */
export const CSRF_HEADER_NAME = 'x-csrf-token';

/** Signature of {@link verifyCsrfToken}; injectable so the hook is testable without Web Crypto-backed HMAC. */
export type CsrfVerifier = (
	token: string,
	sessionId: string,
	secret: Uint8Array | ArrayBuffer,
) => Promise<boolean>;

/** Per-request context the hook needs to validate a token, derived from the event. */
export interface CsrfContext {
	/** The session id the token must be bound to. Return `undefined` for unauthenticated requests. */
	sessionId: string | undefined;
	/** HMAC secret the token was signed with. */
	secret: Uint8Array | ArrayBuffer;
}

export interface HandleCsrfOptions {
	/**
	 * Resolves the per-request CSRF context (session id + secret) from the event.
	 * Return `undefined` to treat the request as having no session.
	 */
	getContext: (event: RequestEvent) => CsrfContext | undefined | Promise<CsrfContext | undefined>;
	/** Cookie name holding the double-submit token. Defaults to `__Host-csrf`. */
	cookieName?: string;
	/** Header name holding the submitted token. Defaults to `x-csrf-token`. */
	headerName?: string;
	/** Override the verifier (defaults to {@link verifyCsrfToken}). */
	verify?: CsrfVerifier;
	/** Builds the rejection response. Defaults to a `403` RFC 9457 problem document. */
	onReject?: (event: RequestEvent, reason: CsrfRejectionReason) => Response;
	/** Methods exempt from enforcement. Defaults to `GET`, `HEAD`, `OPTIONS`, `TRACE`. */
	isSafeMethod?: (method: string) => boolean;
}

export type CsrfRejectionReason =
	| 'no-session'
	| 'cookie-missing'
	| 'header-missing'
	| 'token-mismatch'
	| 'token-invalid';

const CSRF_PROBLEM_TYPE = 'urn:sveltesentio:auth:csrf_failed';

/**
 * SvelteKit `Handle` enforcing the double-submit-cookie CSRF defence on unsafe methods.
 * The submitted header token must equal the cookie token AND verify (HMAC) against the
 * session id + secret from {@link HandleCsrfOptions.getContext}. Safe methods pass through.
 */
export function handleCsrf(options: HandleCsrfOptions): Handle {
	const cookieName = options.cookieName ?? CSRF_COOKIE_NAME;
	const headerName = options.headerName ?? CSRF_HEADER_NAME;
	const verify = options.verify ?? verifyCsrfToken;
	const isSafe = options.isSafeMethod ?? defaultIsSafeMethod;
	const reject = options.onReject ?? defaultReject;

	return async ({ event, resolve }) => {
		if (isSafe(event.request.method)) return resolve(event);

		const context = await options.getContext(event);
		const reason = await evaluateCsrf(event, {
			context,
			cookieName,
			headerName,
			verify,
		});
		if (reason !== undefined) return reject(event, reason);
		return resolve(event);
	};
}

interface EvaluateDeps {
	context: CsrfContext | undefined;
	cookieName: string;
	headerName: string;
	verify: CsrfVerifier;
}

/** Minimal event shape {@link evaluateCsrf} reads — a subset of SvelteKit's `RequestEvent`. */
export interface CsrfEvent {
	request: { method: string; headers: { get(name: string): string | null } };
	cookies: { get(name: string): string | undefined };
}

/**
 * Pure CSRF decision: returns the failure reason, or `undefined` when the request is accepted.
 * Exposed for direct unit testing without a SvelteKit runtime.
 */
export async function evaluateCsrf(
	event: CsrfEvent,
	deps: EvaluateDeps,
): Promise<CsrfRejectionReason | undefined> {
	if (deps.context?.sessionId === undefined) return 'no-session';

	const cookieToken = event.cookies.get(deps.cookieName);
	if (!cookieToken) return 'cookie-missing';

	const headerToken = event.request.headers.get(deps.headerName);
	if (!headerToken) return 'header-missing';
	if (headerToken !== cookieToken) return 'token-mismatch';

	const valid = await deps.verify(headerToken, deps.context.sessionId, deps.context.secret);
	return valid ? undefined : 'token-invalid';
}

function defaultIsSafeMethod(method: string): boolean {
	return !UNSAFE_METHODS.has(method.toUpperCase());
}

function defaultReject(_event: RequestEvent, reason: CsrfRejectionReason): Response {
	const body = JSON.stringify({
		type: CSRF_PROBLEM_TYPE,
		title: 'CSRF validation failed',
		status: 403,
		detail: csrfReasonDetail(reason),
	});
	return new Response(body, {
		status: 403,
		headers: { 'content-type': 'application/problem+json' },
	});
}

function csrfReasonDetail(reason: CsrfRejectionReason): string {
	switch (reason) {
		case 'no-session':
			return 'No authenticated session for this mutation.';
		case 'cookie-missing':
			return 'The CSRF cookie is absent.';
		case 'header-missing':
			return 'The CSRF token header is absent.';
		case 'token-mismatch':
			return 'The submitted token does not match the cookie token.';
		case 'token-invalid':
			return 'The submitted token failed signature verification.';
		default: {
			const exhaustive: never = reason;
			return exhaustive;
		}
	}
}
