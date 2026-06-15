import { describe, expect, it, vi } from 'vitest';
import { Code, ConnectError, type Transport } from '@connectrpc/connect';
import type { DescMethodStreaming, DescService } from '@bufbuild/protobuf';
import { ProblemError } from '@sveltesentio/core/problem';
import {
	createClient,
	createTransport,
	connectErrorToProblem,
	withCredentialsFetch,
} from '../src/rpc/client.js';

/**
 * Minimal server-streaming descriptor stand-in: `createClient` only reads
 * `service.methods` + `method.methodKind` + `method.localName`, so a hand-built
 * shape exercises client construction without running buf codegen. Cast through
 * `unknown` since the full generated `DescService` carries proto internals the
 * client proxy never touches.
 */
function fakeStreamingService(): DescService {
	const method = {
		kind: 'rpc',
		name: 'Tail',
		localName: 'tail',
		methodKind: 'server_streaming',
	} as unknown as DescMethodStreaming;
	return {
		kind: 'service',
		typeName: 'test.v1.FeedService',
		name: 'FeedService',
		methods: [method],
		method: { tail: method },
	} as unknown as DescService;
}

/** Async-iterable of fixed messages, the shape `transport.stream` resolves to. */
async function* yieldAll<T>(items: readonly T[]): AsyncIterable<T> {
	for (const item of items) yield item;
}

describe('createClient', () => {
	it('builds a typed client over an injected transport (test seam)', async () => {
		const service = fakeStreamingService();
		const seen: { hadSignal: boolean } = { hadSignal: false };
		const transport: Transport = {
			unary: () => Promise.reject(new Error('unary not used')),
			stream: (_method, signal) => {
				seen.hadSignal = signal instanceof AbortSignal;
				return Promise.resolve({
					stream: true as const,
					service,
					method: _method,
					header: new Headers(),
					trailer: new Headers(),
					message: yieldAll([{ body: 'a' }, { body: 'b' }]),
				});
			},
		};

		const client = createClient(service, { transport }) as unknown as {
			tail: (req: unknown, opts?: { signal?: AbortSignal }) => AsyncIterable<{ body: string }>;
		};

		const controller = new AbortController();
		const out: string[] = [];
		for await (const msg of client.tail({}, { signal: controller.signal })) out.push(msg.body);

		expect(out).toEqual(['a', 'b']);
		expect(seen.hadSignal).toBe(true);
	});
});

describe('createTransport', () => {
	it('throws without a baseUrl', () => {
		expect(() => createTransport({})).toThrow(/baseUrl/);
	});

	it('builds a transport when given a baseUrl', () => {
		const transport = createTransport({ baseUrl: 'https://api.example.test' });
		expect(typeof transport.unary).toBe('function');
		expect(typeof transport.stream).toBe('function');
	});
});

describe('withCredentialsFetch', () => {
	it('threads the credentials mode into every request init', async () => {
		const seen: Array<RequestCredentials | undefined> = [];
		const base = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
			seen.push(init?.credentials);
			return Promise.resolve(new Response(null, { status: 204 }));
		}) as unknown as typeof globalThis.fetch;

		const wrapped = withCredentialsFetch(base, 'include');
		await wrapped('https://api.example.test/x');
		await wrapped('https://api.example.test/y', { method: 'POST' });

		expect(seen).toEqual(['include', 'include']);
	});

	it('returns the original fetch unchanged when no mode is given', () => {
		const base = (() => Promise.resolve(new Response())) as unknown as typeof globalThis.fetch;
		expect(withCredentialsFetch(base, undefined)).toBe(base);
	});

	it('preserves caller-supplied init fields while adding credentials', async () => {
		let captured: RequestInit | undefined;
		const base = ((_input: RequestInfo | URL, init?: RequestInit) => {
			captured = init;
			return Promise.resolve(new Response(null, { status: 200 }));
		}) as unknown as typeof globalThis.fetch;

		const wrapped = withCredentialsFetch(base, 'same-origin');
		const headers = { 'X-Test': '1' };
		await wrapped('https://api.example.test/z', { method: 'POST', headers });

		expect(captured?.method).toBe('POST');
		expect(captured?.headers).toEqual(headers);
		expect(captured?.credentials).toBe('same-origin');
	});
});

describe('connectErrorToProblem', () => {
	it('maps a NotFound ConnectError to the not_found problem type + 404', () => {
		const problem = connectErrorToProblem(
			new ConnectError('gone', Code.NotFound),
		);
		expect(problem).toBeInstanceOf(ProblemError);
		expect(problem.type).toBe('urn:sveltesentio:rpc:not_found');
		expect(problem.status).toBe(404);
		expect(problem.detail).toBe('gone');
		expect(problem.cause).toBeInstanceOf(ConnectError);
	});

	it('maps PermissionDenied to forbidden + 403 and Unauthenticated to 401', () => {
		expect(connectErrorToProblem(new ConnectError('no', Code.PermissionDenied)).status).toBe(403);
		expect(connectErrorToProblem(new ConnectError('no', Code.Unauthenticated)).type).toBe(
			'urn:sveltesentio:rpc:auth_required',
		);
	});

	it('falls back to a generated urn + status 500 for unmapped codes', () => {
		const problem = connectErrorToProblem(new ConnectError('boom', Code.DataLoss));
		expect(problem.type).toBe('urn:sveltesentio:rpc:data_loss');
		expect(problem.status).toBe(500);
	});

	it('normalises a non-ConnectError reason via ConnectError.from', () => {
		const problem = connectErrorToProblem(new Error('plain'));
		expect(problem).toBeInstanceOf(ProblemError);
		expect(problem.status).toBe(500);
		expect(problem.detail).toBe('plain');
	});

	it('lifts an X-Correlation-Id from error metadata into extensions', () => {
		const err = new ConnectError('x', Code.Internal, { 'X-Correlation-Id': 'cid-123' });
		const problem = connectErrorToProblem(err);
		expect(problem.extensions['correlationId']).toBe('cid-123');
	});
});
