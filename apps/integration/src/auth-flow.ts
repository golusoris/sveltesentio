/**
 * Auth composition: `@sveltesentio/auth` `buildAuthorizationUrl` assembles the
 * OIDC/PKCE redirect, and `handleCsrf` builds the SvelteKit `Handle` that guards
 * unsafe methods with the double-submit-cookie defence. `evaluateCsrf` (the pure
 * decision) is re-exported so the integration test can assert the policy without
 * a SvelteKit runtime.
 */
import {
	buildAuthorizationUrl,
	handleCsrf,
	evaluateCsrf,
	CSRF_COOKIE_NAME,
	CSRF_HEADER_NAME,
} from '@sveltesentio/auth';
import type {
	AuthorizationUrlInit,
	CsrfContext,
	CsrfEvent,
	CsrfRejectionReason,
	CsrfVerifier,
	HandleCsrfOptions,
} from '@sveltesentio/auth';
import type { Handle } from '@sveltejs/kit';

/** Inputs the login route supplies beyond the generated PKCE/state secrets. */
export interface LoginRedirectInit
	extends Pick<AuthorizationUrlInit, 'clientId' | 'redirectUri' | 'scope'> {
	issuer: string;
	state: string;
	nonce: string;
	codeChallenge: string;
}

/** Build the authorization redirect URL for the login route. */
export function loginRedirectUrl(init: LoginRedirectInit): string {
	return buildAuthorizationUrl({
		issuer: init.issuer,
		clientId: init.clientId,
		redirectUri: init.redirectUri,
		scope: init.scope ?? 'openid profile email',
		state: init.state,
		nonce: init.nonce,
		codeChallenge: init.codeChallenge,
	});
}

/**
 * Wire the CSRF `Handle` for `hooks.server.ts`. `getContext` resolves the
 * session id + HMAC secret per request; the default reject returns a 403
 * RFC 9457 problem document.
 */
export function csrfHandle(
	getContext: HandleCsrfOptions['getContext'],
	verify?: CsrfVerifier,
): Handle {
	return handleCsrf(verify ? { getContext, verify } : { getContext });
}

/** Pure CSRF decision for a single event — exercised directly by the test. */
export function decideCsrf(
	event: CsrfEvent,
	context: CsrfContext | undefined,
	verify: CsrfVerifier,
): Promise<CsrfRejectionReason | undefined> {
	return evaluateCsrf(event, {
		context,
		cookieName: CSRF_COOKIE_NAME,
		headerName: CSRF_HEADER_NAME,
		verify,
	});
}

export { CSRF_COOKIE_NAME, CSRF_HEADER_NAME };
