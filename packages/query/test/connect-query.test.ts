import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Code, ConnectError, type CallOptions, type Client } from '@connectrpc/connect';
import type { DescService } from '@bufbuild/protobuf';
import { ProblemError } from '@sveltesentio/core';
import { accessorFromCall, type SvelteQueryMock } from './_svelte-query-mock.js';

// Dynamic import inside the factory keeps `vi.mock` hoisting hoist-safe.
vi.mock('@tanstack/svelte-query', async () => {
	const { svelteQueryMockFactory } = await import('./_svelte-query-mock.js');
	return svelteQueryMockFactory();
});

const sq = (await import('@tanstack/svelte-query')) as unknown as SvelteQueryMock;
const { useConnectQuery, createConnectQuery, connectQueryOptions, connectErrorToProblem } =
	await import('../src/connect-query.js');
import type { UnaryMethodSelector } from '../src/connect-query.js';

beforeEach(() => {
	vi.clearAllMocks();
});

/** Shape returned by a fake `getUser` unary RPC. */
interface User {
	id: number;
	name: string;
}

/**
 * Hand-written stand-in for a generated unary client. `call` only ever invokes
 * the method off the client object, so this structural shape exercises the
 * bridge without running buf codegen. The `client` is passed to `useConnectQuery`
 * cast as `Client<DescService>` (the bridge generic), while the `call` selector
 * casts it back to read the typed `getUser` — mirroring how a real call site
 * picks a method off the generated client.
 */
interface FakeUserClient {
	getUser: (request: { id: number }, options?: CallOptions) => Promise<User>;
}

/**
 * Builds the `call` selector for the suite: picks `getUser({ id })` off the
 * bridge client (cast back to the fake), forwarding the per-call options so the
 * abort `signal` threads through — exactly how a real call site reads a method
 * off a generated client.
 */
const getUserBy =
	(id: number): UnaryMethodSelector<DescService, User> =>
	(c, o) =>
		(c as unknown as FakeUserClient).getUser({ id }, o);

/** Build a fake typed Connect client whose `getUser` resolves to `value`. */
function clientResolving(value: User): {
	client: Client<DescService>;
	getUser: ReturnType<typeof vi.fn>;
} {
	const getUser = vi.fn((_req: { id: number }, _opts?: CallOptions) => Promise.resolve(value));
	const client = { getUser } as unknown as Client<DescService>;
	return { client, getUser };
}

/** Build a fake typed Connect client whose `getUser` rejects with `reason`. */
function clientRejecting(reason: unknown): Client<DescService> {
	const getUser = vi.fn((_req: { id: number }, _opts?: CallOptions) => Promise.reject(reason));
	return { getUser } as unknown as Client<DescService>;
}

describe('connectErrorToProblem — RFC 9457 default mapper', () => {
	it('maps a NotFound ConnectError to a problem with status 404 + urn type', () => {
		const problem = connectErrorToProblem(new ConnectError('gone', Code.NotFound));
		expect(problem).toBeInstanceOf(ProblemError);
		expect(problem.type).toBe('urn:sveltesentio:rpc:not_found');
		expect(problem.status).toBe(404);
		expect(problem.detail).toBe('gone');
		expect(problem.cause).toBeInstanceOf(ConnectError);
	});

	it('maps Unauthenticated → 401 and PermissionDenied → 403', () => {
		expect(connectErrorToProblem(new ConnectError('x', Code.Unauthenticated)).status).toBe(401);
		expect(connectErrorToProblem(new ConnectError('x', Code.PermissionDenied)).status).toBe(403);
	});

	it('maps ResourceExhausted → 429 (so the retry policy treats it as retryable)', () => {
		expect(connectErrorToProblem(new ConnectError('slow down', Code.ResourceExhausted)).status).toBe(
			429,
		);
	});

	it('falls back to status 500 + a generated urn for unmapped codes', () => {
		const problem = connectErrorToProblem(new ConnectError('boom', Code.DataLoss));
		expect(problem.type).toBe('urn:sveltesentio:rpc:data_loss');
		expect(problem.status).toBe(500);
	});

	it('normalises a non-ConnectError reason via ConnectError.from (→ 500)', () => {
		const problem = connectErrorToProblem(new Error('plain'));
		expect(problem).toBeInstanceOf(ProblemError);
		expect(problem.status).toBe(500);
		expect(problem.detail).toBe('plain');
	});

	it('passes an existing ProblemError through untouched (idempotent)', () => {
		const original = new ProblemError({ type: 'urn:x', status: 418 });
		expect(connectErrorToProblem(original)).toBe(original);
	});
});

describe('connectQueryOptions — shaped options (pure, no runes)', () => {
	it('produces a queryFn + the passed key with a 30s stale-time default', () => {
		const { client } = clientResolving({ id: 1, name: 'Ada' });
		const opts = connectQueryOptions<DescService, User, ['user', number]>({
			client,
			queryKey: ['user', 1],
			call: getUserBy(1),
		});
		expect(opts.staleTime).toBe(30_000);
		expect(opts.queryKey).toEqual(['user', 1]);
		expect(typeof opts.queryFn).toBe('function');
	});

	it('lets the caller override the stale-time default (rest spread last)', () => {
		const { client } = clientResolving({ id: 1, name: 'Ada' });
		const opts = connectQueryOptions<DescService, User>({
			client,
			queryKey: ['user', 1],
			call: getUserBy(1),
			staleTime: 0,
		});
		expect(opts.staleTime).toBe(0);
	});

	it('forwards extra TanStack options (enabled) without leaking client/call/mapError', () => {
		const { client } = clientResolving({ id: 1, name: 'Ada' });
		const opts = connectQueryOptions<DescService, User>({
			client,
			queryKey: ['user', 1],
			call: getUserBy(1),
			enabled: false,
		});
		expect(opts.enabled).toBe(false);
		expect('client' in opts).toBe(false);
		expect('call' in opts).toBe(false);
		expect('mapError' in opts).toBe(false);
	});

	it('queryFn invokes the unary method, forwarding the abort signal, and returns its data', async () => {
		const { client, getUser } = clientResolving({ id: 7, name: 'Grace' });
		const opts = connectQueryOptions<DescService, User>({
			client,
			queryKey: ['user', 7],
			call: getUserBy(7),
		});
		const signal = new AbortController().signal;
		const queryFn = opts.queryFn as (ctx: { signal: AbortSignal; queryKey: unknown }) => Promise<User>;
		const data = await queryFn({ signal, queryKey: ['user', 7] });

		expect(data).toEqual({ id: 7, name: 'Grace' });
		expect(getUser).toHaveBeenCalledWith({ id: 7 }, { signal });
	});

	it('queryFn maps a thrown ConnectError to a ProblemError (default mapper)', async () => {
		const client = clientRejecting(new ConnectError('nope', Code.NotFound));
		const opts = connectQueryOptions<DescService, User>({
			client,
			queryKey: ['user', 9],
			call: getUserBy(9),
		});
		const queryFn = opts.queryFn as (ctx: { signal: AbortSignal }) => Promise<User>;

		await expect(queryFn({ signal: new AbortController().signal })).rejects.toMatchObject({
			name: 'ProblemError',
			status: 404,
			type: 'urn:sveltesentio:rpc:not_found',
		});
	});

	it('queryFn routes the thrown reason through a custom mapError', async () => {
		const client = clientRejecting(new ConnectError('rich', Code.Internal));
		const mapError = vi.fn(
			(reason: unknown) => new ProblemError({ type: 'urn:custom', status: 599, cause: reason }),
		);
		const opts = connectQueryOptions<DescService, User>({
			client,
			queryKey: ['user', 1],
			call: getUserBy(1),
			mapError,
		});
		const queryFn = opts.queryFn as (ctx: { signal: AbortSignal }) => Promise<User>;

		await expect(queryFn({ signal: new AbortController().signal })).rejects.toMatchObject({
			type: 'urn:custom',
			status: 599,
		});
		expect(mapError).toHaveBeenCalledOnce();
	});
});

describe('useConnectQuery — v6 Accessor<Options> bridge to createQuery', () => {
	it('passes an Accessor<Options> (a function returning the options) to createQuery', () => {
		const { client } = clientResolving({ id: 1, name: 'Ada' });
		useConnectQuery<DescService, User>({
			client,
			queryKey: ['user', 1],
			call: getUserBy(1),
		});
		expect(sq.createQuery).toHaveBeenCalledOnce();
		expect(typeof sq.createQuery.mock.calls[0]![0]).toBe('function');
	});

	it('the accessor returns the connect-shaped options (30s stale + queryFn)', () => {
		const { client } = clientResolving({ id: 1, name: 'Ada' });
		useConnectQuery<DescService, User, ['user', number]>({
			client,
			queryKey: ['user', 1],
			call: getUserBy(1),
		});
		const opts = accessorFromCall(sq.createQuery)();
		expect(opts.staleTime).toBe(30_000);
		expect(opts.queryKey).toEqual(['user', 1]);
		expect(typeof opts.queryFn).toBe('function');
	});

	it('produces a fresh options object each accessor invocation (no shared mutation)', () => {
		const { client } = clientResolving({ id: 1, name: 'Ada' });
		useConnectQuery<DescService, User>({
			client,
			queryKey: ['user', 1],
			call: getUserBy(1),
		});
		const accessor = accessorFromCall(sq.createQuery);
		expect(accessor()).not.toBe(accessor());
		expect(accessor().queryKey).toEqual(accessor().queryKey);
	});

	it('createConnectQuery is an alias of useConnectQuery', () => {
		expect(createConnectQuery).toBe(useConnectQuery);
	});
});
