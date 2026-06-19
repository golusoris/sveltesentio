import {
	createQuery,
	type CreateQueryOptions,
	type QueryFunctionContext,
	type QueryKey,
} from '@tanstack/svelte-query';
import { Code, ConnectError, type CallOptions, type Client } from '@connectrpc/connect';
import type { DescService } from '@bufbuild/protobuf';
import { ProblemError } from '@sveltesentio/core';

export type { QueryKey };

/**
 * Selects a unary method off a typed ConnectRPC {@link Client} and invokes it
 * with the per-call {@link CallOptions} (carrying the abort `signal`). Returning
 * the client's own method keeps the output type inferred from the descriptor —
 * `(client, opts) => client.getUser({ id }, opts)`.
 */
export type UnaryMethodSelector<T extends DescService, TData> = (
	client: Client<T>,
	options: CallOptions,
) => Promise<TData>;

/**
 * Maps a thrown reason to a {@link ProblemError}. Override to share the richer
 * Connect-`Code`→RFC 9457 vocabulary from `@sveltesentio/realtime/rpc`
 * (`connectErrorToProblem`); the built-in {@link connectErrorToProblem} is a
 * dependency-free default so `@sveltesentio/query` need not depend on realtime.
 */
export type ConnectErrorMapper = (reason: unknown) => ProblemError;

export interface ConnectQueryOptions<T extends DescService, TData, TKey extends QueryKey = QueryKey>
	extends Omit<CreateQueryOptions<TData, ProblemError, TData, TKey>, 'queryFn'> {
	queryKey: TKey;
	/** Typed Connect client; inject a `createRouterTransport(...)`-backed one in tests. */
	client: Client<T>;
	/** Invokes the unary method, forwarding the abort `signal` from TanStack Query. */
	call: UnaryMethodSelector<T, TData>;
	/**
	 * Maps a thrown reason to a {@link ProblemError} so the retry policy keys off
	 * `error.status` (RFC 9457), not a raw `ConnectError`. Defaults to
	 * {@link connectErrorToProblem}.
	 */
	mapError?: ConnectErrorMapper;
}

/** HTTP status each Connect {@link Code} maps to, per the Connect spec. */
const CODE_TO_HTTP_STATUS: Partial<Record<Code, number>> = {
	[Code.Canceled]: 499,
	[Code.Unknown]: 500,
	[Code.InvalidArgument]: 400,
	[Code.DeadlineExceeded]: 504,
	[Code.NotFound]: 404,
	[Code.AlreadyExists]: 409,
	[Code.PermissionDenied]: 403,
	[Code.ResourceExhausted]: 429,
	[Code.FailedPrecondition]: 412,
	[Code.Aborted]: 409,
	[Code.OutOfRange]: 400,
	[Code.Unimplemented]: 501,
	[Code.Internal]: 500,
	[Code.Unavailable]: 503,
	[Code.DataLoss]: 500,
	[Code.Unauthenticated]: 401,
};

/** Lower-cased Connect code name (`NotFound` → `not_found`) for problem types. */
function codeName(code: Code): string {
	const name = Code[code] ?? 'unknown';
	return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/**
 * Dependency-free default that converts any thrown reason into a
 * {@link ProblemError}: a `ConnectError` (or anything `ConnectError.from`
 * normalises) becomes `urn:sveltesentio:rpc:<code>` + the Connect-spec HTTP
 * status, so the shared RFC 9457 retry policy applies. For the fuller
 * vocabulary (curated URNs, correlation-id lifting) pass
 * `@sveltesentio/realtime/rpc`'s `connectErrorToProblem` as `mapError`.
 */
export function connectErrorToProblem(reason: unknown): ProblemError {
	if (reason instanceof ProblemError) return reason;
	const err = ConnectError.from(reason);
	const name = codeName(err.code);
	return new ProblemError({
		type: `urn:sveltesentio:rpc:${name}`,
		title: name,
		status: CODE_TO_HTTP_STATUS[err.code] ?? 500,
		detail: err.rawMessage,
		cause: err,
	});
}

/**
 * Builds the `CreateQueryOptions` (the value an `Accessor<Options>` returns in
 * svelte-query v6) for a unary ConnectRPC call: the `queryFn` invokes the
 * selected method with the abort `signal` from TanStack Query's
 * {@link QueryFunctionContext} and maps any `ConnectError` to a
 * {@link ProblemError}, with a 30s stale-time default. Pure (no runes / Svelte
 * context), so it is unit-testable against a fake `Client`. `useConnectQuery` is
 * the rune-bound wrapper that feeds this to `createQuery`.
 */
export function connectQueryOptions<T extends DescService, TData, TKey extends QueryKey = QueryKey>(
	options: ConnectQueryOptions<T, TData, TKey>,
): CreateQueryOptions<TData, ProblemError, TData, TKey> {
	const { client, call, mapError = connectErrorToProblem, ...rest } = options;
	return {
		staleTime: 30_000,
		...rest,
		queryFn: async ({ signal }: QueryFunctionContext<TKey>) => {
			try {
				return await call(client, { signal });
			} catch (reason) {
				throw mapError(reason);
			}
		},
	};
}

/**
 * ConnectRPC + TanStack Query bridge: runs a typed unary method as a query with
 * the sveltesentio defaults (30s stale time, RFC 9457 retry on `ProblemError`).
 * The abort `signal` from TanStack Query is forwarded into the Connect call, and
 * a thrown `ConnectError` is mapped to a `ProblemError` so the retry policy keys
 * off `error.status`, not the gRPC code. `client` is injected, so this unit-tests
 * against a `createRouterTransport(...)` fake.
 *
 * @example
 * ```ts
 * const q = useConnectQuery({
 *   client,
 *   queryKey: ['user', id],
 *   call: (c, opts) => c.getUser({ id }, opts),
 * });
 * ```
 */
export function useConnectQuery<T extends DescService, TData, TKey extends QueryKey = QueryKey>(
	options: ConnectQueryOptions<T, TData, TKey>,
) {
	return createQuery<TData, ProblemError, TData, TKey>(() => connectQueryOptions(options));
}

/** Alias of {@link useConnectQuery} for call sites preferring `create*` naming. */
export const createConnectQuery = useConnectQuery;
