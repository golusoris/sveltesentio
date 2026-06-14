import { describe, expect, it, vi } from 'vitest';
import { CSRF_HEADER_NAME, evaluateCsrf, handleCsrf } from '../src/csrf-hook.js';
import type { CsrfContext, CsrfVerifier } from '../src/csrf-hook.js';
import { CSRF_COOKIE_NAME } from '../src/cookies.js';
import { issueCsrfToken, verifyCsrfToken } from '../src/csrf.js';
import { randomBytes } from '../src/random.js';

interface FakeEventInit {
	method?: string;
	cookies?: Record<string, string>;
	headers?: Record<string, string>;
}

function fakeEvent(init: FakeEventInit = {}) {
	const cookieJar = init.cookies ?? {};
	return {
		request: new Request('https://app.example/api', {
			method: init.method ?? 'POST',
			headers: init.headers ?? {},
		}),
		cookies: {
			get: (name: string) => cookieJar[name],
		},
	};
}

const SECRET = randomBytes(32);
const CONTEXT: CsrfContext = { sessionId: 'sess_1', secret: SECRET };
const alwaysValid: CsrfVerifier = async () => true;
const alwaysInvalid: CsrfVerifier = async () => false;

describe('evaluateCsrf', () => {
	const deps = {
		cookieName: CSRF_COOKIE_NAME,
		headerName: CSRF_HEADER_NAME,
		verify: alwaysValid,
	};

	it('accepts when cookie === header and the token verifies', async () => {
		const event = fakeEvent({
			cookies: { [CSRF_COOKIE_NAME]: 'tok' },
			headers: { [CSRF_HEADER_NAME]: 'tok' },
		});
		expect(await evaluateCsrf(event, { ...deps, context: CONTEXT })).toBeUndefined();
	});

	it('rejects with no-session when there is no session context', async () => {
		const event = fakeEvent({ cookies: { [CSRF_COOKIE_NAME]: 'tok' } });
		expect(await evaluateCsrf(event, { ...deps, context: undefined })).toBe('no-session');
	});

	it('rejects with cookie-missing when the cookie is absent', async () => {
		const event = fakeEvent({ headers: { [CSRF_HEADER_NAME]: 'tok' } });
		expect(await evaluateCsrf(event, { ...deps, context: CONTEXT })).toBe('cookie-missing');
	});

	it('rejects with header-missing when the header is absent', async () => {
		const event = fakeEvent({ cookies: { [CSRF_COOKIE_NAME]: 'tok' } });
		expect(await evaluateCsrf(event, { ...deps, context: CONTEXT })).toBe('header-missing');
	});

	it('rejects with token-mismatch when cookie and header differ', async () => {
		const event = fakeEvent({
			cookies: { [CSRF_COOKIE_NAME]: 'cookie-tok' },
			headers: { [CSRF_HEADER_NAME]: 'header-tok' },
		});
		expect(await evaluateCsrf(event, { ...deps, context: CONTEXT })).toBe('token-mismatch');
	});

	it('rejects with token-invalid when the verifier fails', async () => {
		const event = fakeEvent({
			cookies: { [CSRF_COOKIE_NAME]: 'tok' },
			headers: { [CSRF_HEADER_NAME]: 'tok' },
		});
		expect(
			await evaluateCsrf(event, { ...deps, verify: alwaysInvalid, context: CONTEXT }),
		).toBe('token-invalid');
	});

	it('accepts a real issued token against the real verifier', async () => {
		const { token } = await issueCsrfToken('sess_1', SECRET);
		const event = fakeEvent({
			cookies: { [CSRF_COOKIE_NAME]: token },
			headers: { [CSRF_HEADER_NAME]: token },
		});
		expect(
			await evaluateCsrf(event, { ...deps, verify: verifyCsrfToken, context: CONTEXT }),
		).toBeUndefined();
	});
});

describe('handleCsrf', () => {
	const passthrough = new Response('ok', { status: 200 });

	it('passes through safe methods without consulting the context', async () => {
		const getContext = vi.fn();
		const hook = handleCsrf({ getContext });
		const resolve = vi.fn(async () => passthrough);
		const event = fakeEvent({ method: 'GET' });
		const out = await hook({
			event: event as never,
			resolve: resolve as never,
		});
		expect(out).toBe(passthrough);
		expect(resolve).toHaveBeenCalledOnce();
		expect(getContext).not.toHaveBeenCalled();
	});

	it('resolves the request when the token is valid', async () => {
		const hook = handleCsrf({ getContext: () => CONTEXT, verify: alwaysValid });
		const resolve = vi.fn(async () => passthrough);
		const event = fakeEvent({
			cookies: { [CSRF_COOKIE_NAME]: 'tok' },
			headers: { [CSRF_HEADER_NAME]: 'tok' },
		});
		const out = await hook({ event: event as never, resolve: resolve as never });
		expect(out).toBe(passthrough);
		expect(resolve).toHaveBeenCalledOnce();
	});

	it('returns a 403 problem response when the token is invalid', async () => {
		const hook = handleCsrf({ getContext: () => CONTEXT, verify: alwaysInvalid });
		const resolve = vi.fn(async () => passthrough);
		const event = fakeEvent({
			cookies: { [CSRF_COOKIE_NAME]: 'tok' },
			headers: { [CSRF_HEADER_NAME]: 'tok' },
		});
		const out = await hook({ event: event as never, resolve: resolve as never });
		expect(resolve).not.toHaveBeenCalled();
		expect(out.status).toBe(403);
		expect(out.headers.get('content-type')).toBe('application/problem+json');
		const body = (await out.json()) as { type: string; status: number };
		expect(body.type).toBe('urn:sveltesentio:auth:csrf_failed');
		expect(body.status).toBe(403);
	});

	it('honours a custom onReject responder', async () => {
		const hook = handleCsrf({
			getContext: () => undefined,
			onReject: () => new Response('denied', { status: 419 }),
		});
		const resolve = vi.fn(async () => passthrough);
		const event = fakeEvent();
		const out = await hook({ event: event as never, resolve: resolve as never });
		expect(out.status).toBe(419);
	});
});
