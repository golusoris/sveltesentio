import { describe, expect, it, vi } from 'vitest';
import { ProblemError } from '@sveltesentio/core';
import { handleSession, resolveSessionLocals } from '../src/session-hook.js';
import type { SessionEvent, SessionResolver } from '../src/session-hook.js';
import { SESSION_COOKIE_NAME } from '../src/cookies.js';

interface Session {
	userId: string;
	permissions: readonly string[];
}

const SESSION: Session = { userId: 'usr_1', permissions: ['billing.read'] };

interface FakeEventInit {
	cookies?: Record<string, string>;
}

function fakeEvent(init: FakeEventInit = {}): SessionEvent<Session> & {
	locals: Record<string, Session | null>;
} {
	const cookieJar = init.cookies ?? {};
	return {
		cookies: {
			get: (name: string) => cookieJar[name],
		},
		locals: {},
	};
}

describe('resolveSessionLocals', () => {
	it('populates locals.session when the cookie resolves to a session', async () => {
		const resolve: SessionResolver<Session> = async () => SESSION;
		const event = fakeEvent({ cookies: { [SESSION_COOKIE_NAME]: 'tok' } });
		await resolveSessionLocals(event, { resolve });
		expect(event.locals.session).toEqual(SESSION);
	});

	it('passes the raw cookie token through to the resolver verbatim', async () => {
		const resolve = vi.fn<SessionResolver<Session>>(async () => SESSION);
		const event = fakeEvent({ cookies: { [SESSION_COOKIE_NAME]: 'opaque-token-xyz' } });
		await resolveSessionLocals(event, { resolve });
		expect(resolve).toHaveBeenCalledExactlyOnceWith('opaque-token-xyz');
	});

	it('sets locals.session to null and skips the resolver when the cookie is absent', async () => {
		const resolve = vi.fn<SessionResolver<Session>>(async () => SESSION);
		const event = fakeEvent();
		await resolveSessionLocals(event, { resolve });
		expect(event.locals.session).toBeNull();
		expect(resolve).not.toHaveBeenCalled();
	});

	it('sets locals.session to null when the resolver rejects the token (invalid/expired)', async () => {
		const resolve: SessionResolver<Session> = async () => null;
		const event = fakeEvent({ cookies: { [SESSION_COOKIE_NAME]: 'stale-tok' } });
		await resolveSessionLocals(event, { resolve });
		expect(event.locals.session).toBeNull();
	});

	it('honours a custom cookieName', async () => {
		const resolve = vi.fn<SessionResolver<Session>>(async () => SESSION);
		const event = fakeEvent({ cookies: { 'x-session': 'tok' } });
		await resolveSessionLocals(event, { resolve, cookieName: 'x-session' });
		expect(resolve).toHaveBeenCalledExactlyOnceWith('tok');
		expect(event.locals.session).toEqual(SESSION);
	});

	it('honours a custom localsKey', async () => {
		const resolve: SessionResolver<Session> = async () => SESSION;
		const event = fakeEvent({ cookies: { [SESSION_COOKIE_NAME]: 'tok' } });
		await resolveSessionLocals(event, { resolve, localsKey: 'auth' });
		expect((event.locals as Record<string, Session | null>).auth).toEqual(SESSION);
		expect(event.locals.session).toBeUndefined();
	});

	it('swallows a thrown resolver error and falls back to null by default (passthrough)', async () => {
		const resolve: SessionResolver<Session> = async () => {
			throw new Error('upstream 503');
		};
		const event = fakeEvent({ cookies: { [SESSION_COOKIE_NAME]: 'tok' } });
		await expect(resolveSessionLocals(event, { resolve })).resolves.toBeUndefined();
		expect(event.locals.session).toBeNull();
	});

	it('rethrows a thrown resolver error when onResolveError is rethrow', async () => {
		const boom = new Error('upstream 503');
		const resolve: SessionResolver<Session> = async () => {
			throw boom;
		};
		const event = fakeEvent({ cookies: { [SESSION_COOKIE_NAME]: 'tok' } });
		await expect(
			resolveSessionLocals(event, { resolve, onResolveError: 'rethrow' }),
		).rejects.toBe(boom);
	});

	it('always rethrows a ProblemError verbatim, even under passthrough', async () => {
		const problem = new ProblemError({
			type: 'urn:golusoris:auth:session_revoked',
			title: 'Session revoked',
			status: 401,
		});
		const resolve: SessionResolver<Session> = async () => {
			throw problem;
		};
		const event = fakeEvent({ cookies: { [SESSION_COOKIE_NAME]: 'tok' } });
		await expect(resolveSessionLocals(event, { resolve })).rejects.toBe(problem);
		await expect(
			resolveSessionLocals(event, { resolve, onResolveError: 'passthrough' }),
		).rejects.toBe(problem);
	});
});

describe('handleSession', () => {
	const passthrough = new Response('ok', { status: 200 });

	it('hydrates locals.session then resolves the request', async () => {
		const resolve: SessionResolver<Session> = async () => SESSION;
		const hook = handleSession({ resolve });
		const event = fakeEvent({ cookies: { [SESSION_COOKIE_NAME]: 'tok' } });
		const kitResolve = vi.fn(async () => passthrough);
		const out = await hook({ event: event as never, resolve: kitResolve as never });
		expect(out).toBe(passthrough);
		expect(kitResolve).toHaveBeenCalledOnce();
		expect(event.locals.session).toEqual(SESSION);
	});

	it('resolves the request as unauthenticated when no cookie is present', async () => {
		const resolve = vi.fn<SessionResolver<Session>>(async () => SESSION);
		const hook = handleSession({ resolve });
		const event = fakeEvent();
		const kitResolve = vi.fn(async () => passthrough);
		const out = await hook({ event: event as never, resolve: kitResolve as never });
		expect(out).toBe(passthrough);
		expect(event.locals.session).toBeNull();
		expect(resolve).not.toHaveBeenCalled();
	});

	it('runs resolution before resolve() so downstream hooks see the session', async () => {
		const order: string[] = [];
		const resolve: SessionResolver<Session> = async () => {
			order.push('resolve-session');
			return SESSION;
		};
		const hook = handleSession({ resolve });
		const event = fakeEvent({ cookies: { [SESSION_COOKIE_NAME]: 'tok' } });
		const kitResolve = vi.fn(async () => {
			order.push('kit-resolve');
			return passthrough;
		});
		await hook({ event: event as never, resolve: kitResolve as never });
		expect(order).toEqual(['resolve-session', 'kit-resolve']);
	});

	it('propagates a ProblemError from the resolver instead of resolving', async () => {
		const problem = new ProblemError({ type: 'urn:golusoris:auth:session_revoked', status: 401 });
		const resolve: SessionResolver<Session> = async () => {
			throw problem;
		};
		const hook = handleSession({ resolve });
		const event = fakeEvent({ cookies: { [SESSION_COOKIE_NAME]: 'tok' } });
		const kitResolve = vi.fn(async () => passthrough);
		await expect(hook({ event: event as never, resolve: kitResolve as never })).rejects.toBe(
			problem,
		);
		expect(kitResolve).not.toHaveBeenCalled();
	});
});
