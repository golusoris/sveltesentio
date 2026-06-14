import { describe, expect, it } from 'vitest';
import {
	CSRF_COOKIE_NAME,
	LOGIN_NONCE_COOKIE_NAME,
	SESSION_COOKIE_NAME,
	csrfCookieOptions,
	loginNonceCookieOptions,
	sessionCookieOptions,
} from '../src/cookies.js';

describe('cookie names', () => {
	it('uses __Host- prefix for session + csrf + login nonce', () => {
		expect(SESSION_COOKIE_NAME).toBe('__Host-session');
		expect(CSRF_COOKIE_NAME).toBe('__Host-csrf');
		expect(LOGIN_NONCE_COOKIE_NAME).toBe('__Host-login-nonce');
	});
});

describe('sessionCookieOptions', () => {
	it('ships HttpOnly + Secure + SameSite=Lax + Path=/', () => {
		const opts = sessionCookieOptions();
		expect(opts.httpOnly).toBe(true);
		expect(opts.secure).toBe(true);
		expect(opts.sameSite).toBe('lax');
		expect(opts.path).toBe('/');
		expect(opts.maxAge).toBe(8 * 60 * 60);
	});

	it('accepts a maxAge override', () => {
		expect(sessionCookieOptions({ maxAge: 60 }).maxAge).toBe(60);
	});
});

describe('csrfCookieOptions', () => {
	it('must be JS-readable (HttpOnly=false) but Secure + Lax', () => {
		const opts = csrfCookieOptions();
		expect(opts.httpOnly).toBe(false);
		expect(opts.secure).toBe(true);
		expect(opts.sameSite).toBe('lax');
		expect(opts.path).toBe('/');
		expect(opts.maxAge).toBe(60 * 60);
	});
});

describe('loginNonceCookieOptions', () => {
	it('scopes to /login path with short TTL', () => {
		const opts = loginNonceCookieOptions();
		expect(opts.path).toBe('/login');
		expect(opts.httpOnly).toBe(true);
		expect(opts.maxAge).toBe(5 * 60);
	});
});
