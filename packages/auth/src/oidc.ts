import { ProblemError, isProblemResponse, problemFromResponse } from '@sveltesentio/core';
import { generateNonce, generateState } from './random.js';
import { generatePkceChallenge } from './pkce.js';
import type { PkceChallenge } from './pkce.js';

/** Subset of the global `fetch` the OIDC helpers need; injectable for tests + SvelteKit's `event.fetch`. */
export type FetchLike = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

/** Inputs to {@link buildAuthorizationUrl}. Either `authorizationEndpoint` or `issuer` must be supplied. */
export interface AuthorizationUrlInit {
	/** Full authorization endpoint URL. Takes precedence over {@link AuthorizationUrlInit.issuer}. */
	authorizationEndpoint?: string;
	/** Issuer base; the endpoint is derived as `${issuer}/authorize` when `authorizationEndpoint` is absent. */
	issuer?: string;
	clientId: string;
	redirectUri: string;
	/** Space-delimited scopes. Defaults to `openid`. */
	scope?: string;
	state: string;
	nonce?: string;
	codeChallenge: string;
	codeChallengeMethod?: 'S256';
	responseType?: 'code';
	/** Extra non-standard params (e.g. `prompt`, `login_hint`, `provider`) appended verbatim. */
	extraParams?: Readonly<Record<string, string>>;
}

/** Bundles a fresh PKCE pair, state, nonce, and the ready-to-redirect authorization URL. */
export interface AuthorizationRequest {
	url: string;
	state: string;
	nonce: string;
	codeVerifier: string;
	codeChallenge: string;
}

/** Builds the OAuth 2.0 / OIDC authorization URL with PKCE (RFC 7636) query parameters. */
export function buildAuthorizationUrl(init: AuthorizationUrlInit): string {
	const endpoint = resolveAuthorizationEndpoint(init);
	const url = new URL(endpoint);
	const params = url.searchParams;
	params.set('response_type', init.responseType ?? 'code');
	params.set('client_id', init.clientId);
	params.set('redirect_uri', init.redirectUri);
	params.set('scope', init.scope ?? 'openid');
	params.set('state', init.state);
	params.set('code_challenge', init.codeChallenge);
	params.set('code_challenge_method', init.codeChallengeMethod ?? 'S256');
	if (init.nonce !== undefined) params.set('nonce', init.nonce);
	if (init.extraParams) {
		for (const [key, value] of Object.entries(init.extraParams)) params.set(key, value);
	}
	return url.toString();
}

/** Inputs for {@link createAuthorizationRequest}: everything {@link buildAuthorizationUrl} needs minus the generated secrets. */
export interface AuthorizationRequestInit
	extends Omit<AuthorizationUrlInit, 'state' | 'nonce' | 'codeChallenge'> {
	/** Override the generated state (defaults to a fresh CSPRNG value). */
	state?: string;
	/** Override the generated nonce (defaults to a fresh CSPRNG value). */
	nonce?: string;
}

/**
 * Generates a fresh PKCE pair + `state` + `nonce` and assembles the authorization URL.
 * Persist the returned `state`, `nonce`, and `codeVerifier` (e.g. in the login-nonce cookie)
 * to validate the callback and complete {@link exchangeAuthorizationCode}.
 */
export async function createAuthorizationRequest(
	init: AuthorizationRequestInit,
): Promise<AuthorizationRequest> {
	const pkce: PkceChallenge = await generatePkceChallenge();
	const state = init.state ?? generateState();
	const nonce = init.nonce ?? generateNonce();
	const url = buildAuthorizationUrl({
		...init,
		state,
		nonce,
		codeChallenge: pkce.challenge,
		codeChallengeMethod: pkce.method,
	});
	return { url, state, nonce, codeVerifier: pkce.verifier, codeChallenge: pkce.challenge };
}

/** Inputs to {@link exchangeAuthorizationCode}. */
export interface TokenExchangeInit {
	tokenEndpoint: string;
	clientId: string;
	redirectUri: string;
	code: string;
	codeVerifier: string;
	/** Public-client default is `authorization_code`; overridable for refresh flows. */
	grantType?: string;
	/** Confidential clients may pass a secret (sent as `client_secret`). Omit for public PKCE clients. */
	clientSecret?: string;
	/** Injected fetch; defaults to the global. Pass `event.fetch` in SvelteKit server load. */
	fetch?: FetchLike;
}

/** Parsed RFC 6749 §5.1 token response. Unknown fields are preserved on the object. */
export interface TokenResponse {
	access_token: string;
	token_type: string;
	expires_in?: number;
	refresh_token?: string;
	id_token?: string;
	scope?: string;
	[key: string]: unknown;
}

const TOKEN_EXCHANGE_FAILED = 'urn:sveltesentio:auth:token_exchange_failed';

/**
 * Performs the RFC 7636 PKCE authorization-code → token exchange.
 * Throws a {@link ProblemError} (from `@sveltesentio/core`) on any non-2xx response,
 * preferring the server's RFC 9457 `application/problem+json` body when present.
 */
export async function exchangeAuthorizationCode(init: TokenExchangeInit): Promise<TokenResponse> {
	const doFetch = init.fetch ?? globalThis.fetch;
	const body = new URLSearchParams();
	body.set('grant_type', init.grantType ?? 'authorization_code');
	body.set('client_id', init.clientId);
	body.set('redirect_uri', init.redirectUri);
	body.set('code', init.code);
	body.set('code_verifier', init.codeVerifier);
	if (init.clientSecret !== undefined) body.set('client_secret', init.clientSecret);

	let response: Response;
	try {
		response = await doFetch(init.tokenEndpoint, {
			method: 'POST',
			headers: {
				'content-type': 'application/x-www-form-urlencoded',
				accept: 'application/json',
			},
			body: body.toString(),
		});
	} catch (cause) {
		throw new ProblemError({
			type: TOKEN_EXCHANGE_FAILED,
			title: 'Token exchange request failed',
			detail: 'The token endpoint could not be reached.',
			cause,
		});
	}

	if (!response.ok) {
		throw await problemFromTokenResponse(response);
	}

	let parsed: unknown;
	try {
		parsed = await response.json();
	} catch (cause) {
		throw new ProblemError({
			type: TOKEN_EXCHANGE_FAILED,
			title: 'Malformed token response',
			status: response.status,
			detail: 'The token endpoint returned a body that is not valid JSON.',
			cause,
		});
	}

	if (!isTokenResponse(parsed)) {
		throw new ProblemError({
			type: TOKEN_EXCHANGE_FAILED,
			title: 'Invalid token response',
			status: response.status,
			detail: 'The token response is missing a string `access_token`.',
		});
	}
	return parsed;
}

function resolveAuthorizationEndpoint(init: AuthorizationUrlInit): string {
	if (init.authorizationEndpoint) return init.authorizationEndpoint;
	if (init.issuer) return `${init.issuer.replace(/\/+$/, '')}/authorize`;
	throw new ProblemError({
		type: TOKEN_EXCHANGE_FAILED,
		title: 'Missing authorization endpoint',
		detail: 'Provide either `authorizationEndpoint` or `issuer`.',
	});
}

async function problemFromTokenResponse(response: Response): Promise<ProblemError> {
	let body: unknown;
	try {
		body = isProblemResponse(response) ? await response.json() : await response.text();
	} catch {
		body = undefined;
	}
	return problemFromResponse(response, body);
}

function isTokenResponse(value: unknown): value is TokenResponse {
	if (typeof value !== 'object' || value === null) return false;
	const record = value as Record<string, unknown>;
	return typeof record['access_token'] === 'string';
}
