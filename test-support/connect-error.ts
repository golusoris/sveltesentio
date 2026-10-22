import { ProblemError } from '@sveltesentio/core';

/**
 * Structural shape of Connect code identifiers needed by the shared error contract.
 */
export interface ConnectCodeLike {
	NotFound: number;
	Unauthenticated: number;
	PermissionDenied: number;
	DataLoss: number;
}

/**
 * Structural contract for the Connect error constructor.
 *
 * Injected by packages because the repository root does not install `@connectrpc/connect`.
 */
export interface ConnectErrorConstructorLike {
	new (message: string, code?: number): Error;
}

/**
 * Structural contract for the `describe` test suite function.
 *
 * Injected by packages because the repository root does not install `vitest`.
 */
export interface DescribeLike {
	(name: string, fn: () => void): void;
}

/**
 * Structural contract for the `it` test case function.
 *
 * Injected by packages because the repository root does not install `vitest`.
 */
export interface ItLike {
	(name: string, fn: () => void): void;
}

/**
 * Minimal structural assertion matchers used by the shared error contract suite.
 */
export interface ExpectAssertionLike {
	toBe(expected: unknown): void;
	toBeInstanceOf(expected: unknown): void;
}

/**
 * Structural contract for the `expect` test assertion factory.
 *
 * Injected by packages because the repository root does not install `vitest`.
 */
export interface ExpectLike {
	(actual: unknown): ExpectAssertionLike;
}

/**
 * Options for configuring the shared Connect error contract suite.
 */
export interface DescribeConnectErrorContractOptions {
	/** Maps a thrown reason to an RFC 9457 ProblemError. */
	map: (reason: unknown) => ProblemError;
	/** ConnectError constructor for instantiation and instanceof checks. */
	ConnectError: ConnectErrorConstructorLike;
	/** Connect Code enum / lookup table providing status codes. */
	Code: ConnectCodeLike;
	/** Vitest `describe`. */
	describe: DescribeLike;
	/** Vitest `it`. */
	it: ItLike;
	/** Vitest `expect`. */
	expect: ExpectLike;
}

/**
 * Registers the shared RFC 9457 mapping contract suite for ConnectRPC errors.
 *
 * Shared between `@sveltesentio/query` and `@sveltesentio/realtime`.
 */
export function describeConnectErrorContract(
	name: string,
	options: DescribeConnectErrorContractOptions,
): void {
	const { map, ConnectError, Code, describe, it, expect } = options;

	describe(name, () => {
		it('maps a NotFound ConnectError to a problem with status 404 + urn type', () => {
			const problem = map(new ConnectError('gone', Code.NotFound));
			expect(problem).toBeInstanceOf(ProblemError);
			expect(problem.type).toBe('urn:sveltesentio:rpc:not_found');
			expect(problem.status).toBe(404);
			expect(problem.detail).toBe('gone');
			expect(problem.cause).toBeInstanceOf(ConnectError);
		});

		it('maps Unauthenticated → 401 and PermissionDenied → 403', () => {
			expect(map(new ConnectError('x', Code.Unauthenticated)).status).toBe(401);
			expect(map(new ConnectError('x', Code.PermissionDenied)).status).toBe(403);
		});

		it('falls back to status 500 + a generated urn for unmapped codes', () => {
			const problem = map(new ConnectError('boom', Code.DataLoss));
			expect(problem.type).toBe('urn:sveltesentio:rpc:data_loss');
			expect(problem.status).toBe(500);
		});

		it('normalises a non-ConnectError reason via ConnectError.from (→ 500)', () => {
			const problem = map(new Error('plain'));
			expect(problem).toBeInstanceOf(ProblemError);
			expect(problem.status).toBe(500);
			expect(problem.detail).toBe('plain');
		});
	});
}
