import { ProblemError } from '@sveltesentio/core';
import { describe, expect, it, vi } from 'vitest';
import {
	buildAuthorizationUrl,
	createAuthorizationRequest,
	exchangeAuthorizationCode,
} from '../src/oidc.js';
import type { FetchLike } from '../src/oidc.js';

describe('buildAuthorizationUrl', () => {
	it('builds a PKCE authorization URL with all required query params', () => {
		const url = buildAuthorizationUrl({
			authorizationEndpoint: 'https://idp.example/authorize',
			clientId: 'web-app',
			redirectUri: 'https://app.example/callback',
			scope: 'openid profile',
			state: 'state-123',
			nonce: 'nonce-456',
			codeChallenge: 'challenge-abc',
		});
		const parsed = new URL(url);
		expect(parsed.origin + parsed.pathname).toBe('https://idp.example/authorize');
		const p = parsed.searchParams;
		expect(p.get('response_type')).toBe('code');
		expect(p.get('client_id')).toBe('web-app');
		expect(p.get('redirect_uri')).toBe('https://app.example/callback');
		expect(p.get('scope')).toBe('openid profile');
		expect(p.get('state')).toBe('state-123');
		expect(p.get('nonce')).toBe('nonce-456');
		expect(p.get('code_challenge')).toBe('challenge-abc');
		expect(p.get('code_challenge_method')).toBe('S256');
	});

	it('derives the endpoint from issuer and defaults scope to openid', () => {
		const url = buildAuthorizationUrl({
			issuer: 'https://idp.example/',
			clientId: 'app',
			redirectUri: 'https://app.example/cb',
			state: 's',
			codeChallenge: 'c',
		});
		const parsed = new URL(url);
		expect(parsed.pathname).toBe('/authorize');
		expect(parsed.searchParams.get('scope')).toBe('openid');
		expect(parsed.searchParams.has('nonce')).toBe(false);
	});

	it('appends extraParams verbatim (first-party adapter point)', () => {
		const url = buildAuthorizationUrl({
			authorizationEndpoint: 'https://app.example/auth/oidc/start',
			clientId: 'app',
			redirectUri: 'https://app.example/cb',
			state: 's',
			codeChallenge: 'c',
			extraParams: { provider: 'github', prompt: 'consent' },
		});
		const p = new URL(url).searchParams;
		expect(p.get('provider')).toBe('github');
		expect(p.get('prompt')).toBe('consent');
	});

	it('throws a ProblemError when neither endpoint nor issuer is supplied', () => {
		expect(() =>
			buildAuthorizationUrl({
				clientId: 'app',
				redirectUri: 'https://app.example/cb',
				state: 's',
				codeChallenge: 'c',
			}),
		).toThrow(ProblemError);
	});
});

describe('createAuthorizationRequest', () => {
	it('generates a real PKCE challenge, state, nonce, and a matching URL', async () => {
		const req = await createAuthorizationRequest({
			issuer: 'https://idp.example',
			clientId: 'app',
			redirectUri: 'https://app.example/cb',
		});
		expect(req.codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(req.codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(req.state).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(req.nonce).toMatch(/^[A-Za-z0-9_-]+$/);
		const p = new URL(req.url).searchParams;
		expect(p.get('state')).toBe(req.state);
		expect(p.get('nonce')).toBe(req.nonce);
		expect(p.get('code_challenge')).toBe(req.codeChallenge);
	});

	it('honours caller-supplied state and nonce', async () => {
		const req = await createAuthorizationRequest({
			issuer: 'https://idp.example',
			clientId: 'app',
			redirectUri: 'https://app.example/cb',
			state: 'fixed-state',
			nonce: 'fixed-nonce',
		});
		expect(req.state).toBe('fixed-state');
		expect(req.nonce).toBe('fixed-nonce');
	});
});

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

describe('exchangeAuthorizationCode', () => {
	const base = {
		tokenEndpoint: 'https://idp.example/token',
		clientId: 'app',
		redirectUri: 'https://app.example/cb',
		code: 'auth-code',
		codeVerifier: 'verifier',
	};

	it('POSTs the PKCE exchange and parses the token response', async () => {
		const fetchMock = vi.fn<FetchLike>(async (_input, init) => {
			const body = new URLSearchParams(String(init?.body));
			expect(init?.method).toBe('POST');
			expect(body.get('grant_type')).toBe('authorization_code');
			expect(body.get('code')).toBe('auth-code');
			expect(body.get('code_verifier')).toBe('verifier');
			expect(body.get('client_id')).toBe('app');
			return jsonResponse({
				access_token: 'at',
				token_type: 'Bearer',
				expires_in: 3600,
				refresh_token: 'rt',
			});
		});
		const tokens = await exchangeAuthorizationCode({ ...base, fetch: fetchMock });
		expect(tokens.access_token).toBe('at');
		expect(tokens.refresh_token).toBe('rt');
		expect(tokens.expires_in).toBe(3600);
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it('throws a ProblemError carrying the RFC 9457 body on non-2xx', async () => {
		const fetchMock = vi.fn<FetchLike>(async () =>
			new Response(
				JSON.stringify({
					type: 'urn:golusoris:auth:invalid_grant',
					title: 'Invalid grant',
					status: 400,
					detail: 'The authorization code expired.',
				}),
				{ status: 400, headers: { 'content-type': 'application/problem+json' } },
			),
		);
		await expect(exchangeAuthorizationCode({ ...base, fetch: fetchMock })).rejects.toMatchObject({
			type: 'urn:golusoris:auth:invalid_grant',
			status: 400,
			detail: 'The authorization code expired.',
		});
	});

	it('throws a ProblemError on a plain non-2xx without a problem body', async () => {
		const fetchMock = vi.fn<FetchLike>(async () =>
			new Response('nope', { status: 500, statusText: 'Server Error' }),
		);
		const error = await exchangeAuthorizationCode({ ...base, fetch: fetchMock }).catch((e) => e);
		expect(error).toBeInstanceOf(ProblemError);
		expect((error as ProblemError).status).toBe(500);
	});

	it('throws a ProblemError when the network request itself fails', async () => {
		const fetchMock = vi.fn<FetchLike>(async () => {
			throw new TypeError('network down');
		});
		const error = await exchangeAuthorizationCode({ ...base, fetch: fetchMock }).catch((e) => e);
		expect(error).toBeInstanceOf(ProblemError);
		expect((error as ProblemError).type).toBe('urn:sveltesentio:auth:token_exchange_failed');
	});

	it('throws a ProblemError when access_token is missing', async () => {
		const fetchMock = vi.fn<FetchLike>(async () => jsonResponse({ token_type: 'Bearer' }));
		const error = await exchangeAuthorizationCode({ ...base, fetch: fetchMock }).catch((e) => e);
		expect(error).toBeInstanceOf(ProblemError);
		expect((error as ProblemError).detail).toContain('access_token');
	});
});
