export type SameSite = 'lax' | 'strict' | 'none';

export interface CookieOptions {
	path: string;
	httpOnly: boolean;
	secure: boolean;
	sameSite: SameSite;
	maxAge?: number;
}

export interface SessionCookieOptionsInit {
	maxAge?: number;
	sameSite?: SameSite;
}

export interface CsrfCookieOptionsInit {
	maxAge?: number;
	sameSite?: SameSite;
}

export const SESSION_COOKIE_NAME = '__Host-session';
export const CSRF_COOKIE_NAME = '__Host-csrf';
export const LOGIN_NONCE_COOKIE_NAME = '__Host-login-nonce';

const EIGHT_HOURS = 8 * 60 * 60;
const ONE_HOUR = 60 * 60;
const FIVE_MINUTES = 5 * 60;

export function sessionCookieOptions(init: SessionCookieOptionsInit = {}): CookieOptions {
	return {
		path: '/',
		httpOnly: true,
		secure: true,
		sameSite: init.sameSite ?? 'lax',
		maxAge: init.maxAge ?? EIGHT_HOURS,
	};
}

export function csrfCookieOptions(init: CsrfCookieOptionsInit = {}): CookieOptions {
	return {
		path: '/',
		httpOnly: false,
		secure: true,
		sameSite: init.sameSite ?? 'lax',
		maxAge: init.maxAge ?? ONE_HOUR,
	};
}

export function loginNonceCookieOptions(maxAge = FIVE_MINUTES): CookieOptions {
	return {
		path: '/login',
		httpOnly: true,
		secure: true,
		sameSite: 'lax',
		maxAge,
	};
}
