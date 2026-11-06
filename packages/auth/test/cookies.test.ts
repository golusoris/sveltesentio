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
	it('sets Path=/ with short TTL for __Host- compatibility', () => {
		const opts = loginNonceCookieOptions();
		expect(opts.path).toBe('/');
		expect(opts.httpOnly).toBe(true);
		expect(opts.secure).toBe(true);
		expect(opts.sameSite).toBe('lax');
		expect(opts.maxAge).toBe(5 * 60);
	});
});

describe('__Host- cookie invariant across helpers', () => {
	function isValidHostCookie(opts: { path?: string; secure?: boolean; domain?: string }): boolean {
		return opts.path === '/' && opts.secure === true && !('domain' in opts);
	}

	it('pairs every __Host- name with path=/, secure=true, and no domain key (positive)', () => {
		const pairs = [
			{ name: SESSION_COOKIE_NAME, opts: sessionCookieOptions() },
			{ name: CSRF_COOKIE_NAME, opts: csrfCookieOptions() },
			{ name: LOGIN_NONCE_COOKIE_NAME, opts: loginNonceCookieOptions() },
		];

		for (const { name, opts } of pairs) {
			expect(name.startsWith('__Host-')).toBe(true);
			expect(opts.path).toBe('/');
			expect(opts.secure).toBe(true);
			expect('domain' in opts).toBe(false);
			expect(isValidHostCookie(opts)).toBe(true);
		}
	});

	it('rejects options with path /login, missing secure, or domain key (negative)', () => {
		const badPath = { path: '/login', secure: true };
		expect(isValidHostCookie(badPath)).toBe(false);

		const badDomain = { path: '/', secure: true, domain: 'example.com' };
		expect(isValidHostCookie(badDomain)).toBe(false);

		const badInsecure = { path: '/', secure: false };
		expect(isValidHostCookie(badInsecure)).toBe(false);
	});

	it('keeps path / for boundary maxAge 0 and 1 (boundary)', () => {
		for (const maxAge of [0, 1]) {
			const opts = loginNonceCookieOptions(maxAge);
			expect(opts.path).toBe('/');
			expect(opts.maxAge).toBe(maxAge);
			expect(isValidHostCookie(opts)).toBe(true);
		}
	});
});
