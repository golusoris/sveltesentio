import { ProblemError } from '@sveltesentio/core';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { exchangeAuthorizationCode } from '../src/oidc.js';
import type { FetchLike, TokenExchangeInit } from '../src/oidc.js';

const ISSUER = 'https://idp.example';
const JWKS_URI = 'https://idp.example/jwks';
const NONCE = 'nonce-123';

const alg = {
	name: 'RSASSA-PKCS1-v1_5',
	modulusLength: 2048,
	publicExponent: new Uint8Array([1, 0, 1]),
	hash: 'SHA-256',
};

let signingKey: CryptoKeyPair;
let foreignKey: CryptoKeyPair;
let jwks: { keys: JsonWebKey[] };

beforeAll(async () => {
	signingKey = await crypto.subtle.generateKey(alg, true, ['sign', 'verify']);
	foreignKey = await crypto.subtle.generateKey(alg, true, ['sign', 'verify']);
	const publicJwk = await crypto.subtle.exportKey('jwk', signingKey.publicKey);
	jwks = { keys: [{ ...publicJwk, kid: 'k1', alg: 'RS256', use: 'sig' } as JsonWebKey] };
});

function b64u(data: string | Uint8Array): string {
	const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
	return Buffer.from(bytes).toString('base64url');
}

async function signIdToken(
	claims: Record<string, unknown>,
	key = signingKey.privateKey,
): Promise<string> {
	const input = `${b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'k1' }))}.${b64u(JSON.stringify(claims))}`;
	const signature = await crypto.subtle.sign(alg.name, key, new TextEncoder().encode(input));
	return `${input}.${b64u(new Uint8Array(signature))}`;
}

function validClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	const now = Math.floor(Date.now() / 1000);
	return {
		iss: ISSUER,
		aud: 'app',
		sub: 'user-1',
		iat: now,
		exp: now + 300,
		nonce: NONCE,
		...overrides,
	};
}

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	});
}

function idpFetch(idToken: string) {
	return vi.fn<FetchLike>((input) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		if (url === JWKS_URI) return Promise.resolve(jsonResponse(jwks));
		return Promise.resolve(
			jsonResponse({ access_token: 'at', token_type: 'Bearer', id_token: idToken }),
		);
	});
}

const base: TokenExchangeInit = {
	tokenEndpoint: 'https://idp.example/token',
	clientId: 'app',
	redirectUri: 'https://app.example/cb',
	code: 'auth-code',
	codeVerifier: 'verifier',
	issuer: ISSUER,
	jwksUri: JWKS_URI,
	nonce: NONCE,
};

function without(field: 'issuer' | 'jwksUri' | 'nonce'): TokenExchangeInit {
	const rest = { ...base };
	delete rest[field];
	return rest;
}

async function expectRejected(init: TokenExchangeInit): Promise<ProblemError> {
	const error = await exchangeAuthorizationCode(init).catch((e: unknown) => e);
	expect(error).toBeInstanceOf(ProblemError);
	expect((error as ProblemError).title).toBe('Invalid ID token');
	return error as ProblemError;
}

describe('exchangeAuthorizationCode id_token validation', () => {
	it('accepts a correctly signed id_token with matching claims', async () => {
		const idToken = await signIdToken(validClaims());
		const fetchMock = idpFetch(idToken);
		const tokens = await exchangeAuthorizationCode({ ...base, fetch: fetchMock });
		expect(tokens.id_token).toBe(idToken);
		expect(fetchMock).toHaveBeenCalledWith(JWKS_URI, expect.anything());
	});

	it('rejects an id_token with a wrong nonce', async () => {
		const idToken = await signIdToken(validClaims({ nonce: 'attacker-nonce' }));
		await expectRejected({ ...base, fetch: idpFetch(idToken) });
	});

	it('rejects an id_token issued for another audience', async () => {
		const idToken = await signIdToken(validClaims({ aud: 'other-app' }));
		await expectRejected({ ...base, fetch: idpFetch(idToken) });
	});

	it('rejects an id_token from another issuer', async () => {
		const idToken = await signIdToken(validClaims({ iss: 'https://evil.example' }));
		await expectRejected({ ...base, fetch: idpFetch(idToken) });
	});

	it('rejects an expired id_token', async () => {
		const now = Math.floor(Date.now() / 1000);
		const idToken = await signIdToken(validClaims({ iat: now - 600, exp: now - 300 }));
		await expectRejected({ ...base, fetch: idpFetch(idToken) });
	});

	it('rejects an id_token signed by a key outside the JWKS', async () => {
		const idToken = await signIdToken(validClaims(), foreignKey.privateKey);
		await expectRejected({ ...base, fetch: idpFetch(idToken) });
	});

	it('rejects an id_token whose alg is not accepted', async () => {
		const idToken = await signIdToken(validClaims());
		await expectRejected({ ...base, idTokenSigningAlgs: ['ES256'], fetch: idpFetch(idToken) });
	});

	it.each(['issuer', 'jwksUri', 'nonce'] as const)(
		'rejects an id_token when %s is not supplied',
		async (field) => {
			const idToken = await signIdToken(validClaims());
			const error = await expectRejected({ ...without(field), fetch: idpFetch(idToken) });
			expect(error.detail).toContain('jwksUri');
		},
	);

	it('validates a refreshed id_token without a nonce', async () => {
		const idToken = await signIdToken(validClaims({ nonce: undefined }));
		const tokens = await exchangeAuthorizationCode({
			...without('nonce'),
			grantType: 'refresh_token',
			fetch: idpFetch(idToken),
		});
		expect(tokens.id_token).toBe(idToken);
	});

	it('skips validation when the response has no id_token', async () => {
		const fetchMock = vi.fn<FetchLike>(() =>
			Promise.resolve(jsonResponse({ access_token: 'at', token_type: 'Bearer' })),
		);
		const tokens = await exchangeAuthorizationCode({ ...without('issuer'), fetch: fetchMock });
		expect(tokens.access_token).toBe('at');
		expect(fetchMock).toHaveBeenCalledOnce();
	});
});
