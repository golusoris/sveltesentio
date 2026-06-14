import { describe, it, expect, vi } from 'vitest';
import {
	loginRedirectUrl,
	decideCsrf,
	csrfHandle,
	CSRF_COOKIE_NAME,
	CSRF_HEADER_NAME,
} from '../src/auth-flow.js';
import type { CsrfContext, CsrfEvent, CsrfVerifier } from '@sveltesentio/auth';

/** Build a minimal CsrfEvent (the subset evaluateCsrf reads). */
function csrfEvent(method: string, cookie?: string, header?: string): CsrfEvent {
	return {
		request: {
			method,
			headers: { get: (name: string) => (name === CSRF_HEADER_NAME ? (header ?? null) : null) },
		},
		cookies: { get: (name: string) => (name === CSRF_COOKIE_NAME ? cookie : undefined) },
	};
}

const context: CsrfContext = { sessionId: 'sess-1', secret: new Uint8Array([1, 2, 3]) };
const alwaysValid: CsrfVerifier = () => Promise.resolve(true);
const alwaysInvalid: CsrfVerifier = () => Promise.resolve(false);

describe('auth buildAuthorizationUrl composition', () => {
	it('builds a PKCE authorization URL from an issuer', () => {
		const url = loginRedirectUrl({
			issuer: 'https://idp.example',
			clientId: 'integration-app',
			redirectUri: 'https://app.example/callback',
			state: 'state-xyz',
			nonce: 'nonce-abc',
			codeChallenge: 'challenge-123',
		});
		const parsed = new URL(url);
		expect(parsed.origin + parsed.pathname).toBe('https://idp.example/authorize');
		const p = parsed.searchParams;
		expect(p.get('response_type')).toBe('code');
		expect(p.get('client_id')).toBe('integration-app');
		expect(p.get('redirect_uri')).toBe('https://app.example/callback');
		expect(p.get('scope')).toBe('openid profile email');
		expect(p.get('state')).toBe('state-xyz');
		expect(p.get('nonce')).toBe('nonce-abc');
		expect(p.get('code_challenge')).toBe('challenge-123');
		expect(p.get('code_challenge_method')).toBe('S256');
	});
});

describe('auth handleCsrf composition', () => {
	it('accepts a matching, verifying token on an unsafe method', async () => {
		const reason = await decideCsrf(
			csrfEvent('POST', 'tok-aaa', 'tok-aaa'),
			context,
			alwaysValid,
		);
		expect(reason).toBeUndefined();
	});

	it('rejects when the header token is missing', async () => {
		const reason = await decideCsrf(csrfEvent('POST', 'tok-aaa'), context, alwaysValid);
		expect(reason).toBe('header-missing');
	});

	it('rejects when the cookie and header tokens differ', async () => {
		const reason = await decideCsrf(
			csrfEvent('POST', 'tok-aaa', 'tok-bbb'),
			context,
			alwaysValid,
		);
		expect(reason).toBe('token-mismatch');
	});

	it('rejects when the token fails signature verification', async () => {
		const reason = await decideCsrf(
			csrfEvent('POST', 'tok-aaa', 'tok-aaa'),
			context,
			alwaysInvalid,
		);
		expect(reason).toBe('token-invalid');
	});

	it('rejects an unauthenticated mutation as no-session', async () => {
		const reason = await decideCsrf(
			csrfEvent('POST', 'tok-aaa', 'tok-aaa'),
			undefined,
			alwaysValid,
		);
		expect(reason).toBe('no-session');
	});

	it('the SvelteKit Handle passes safe methods straight through', async () => {
		const getContext = vi.fn(() => context);
		const handle = csrfHandle(getContext, alwaysValid);
		const resolve = vi.fn(() => Promise.resolve(new Response('ok')));
		// Narrow stub via the Handle's own parameter type — no `any`.
		const event = {
			request: new Request('https://app.example/', { method: 'GET' }),
		} as Parameters<typeof handle>[0]['event'];
		const response = await handle({ event, resolve });
		expect(await response.text()).toBe('ok');
		// Safe method: context resolver is never consulted.
		expect(getContext).not.toHaveBeenCalled();
	});
});
