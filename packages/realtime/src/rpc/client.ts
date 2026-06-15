import {
	Code,
	ConnectError,
	createClient as createConnectClient,
	type Client,
	type Interceptor,
	type Transport,
} from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import type { DescService } from '@bufbuild/protobuf';
import { ProblemError } from '@sveltesentio/core/problem';

/**
 * Options for {@link createClient}. The `transport` may be supplied directly
 * (tests inject a `createRouterTransport(...)` fake), otherwise a Connect-web
 * HTTP transport is built from `baseUrl` + `fetch` + `interceptors`.
 */
export interface CreateClientOptions {
	/**
	 * Pre-built transport. When provided, `baseUrl` / `fetch` / `interceptors` /
	 * `useBinaryFormat` / `credentials` are ignored. This is the test seam — pass
	 * a `createRouterTransport(...)` from `@connectrpc/connect`.
	 */
	transport?: Transport;
	/** Base URI for all RPCs. Required unless an explicit `transport` is given. */
	baseUrl?: string;
	/**
	 * Injectable `fetch`. Use SvelteKit's `event.fetch` for SSR so cookies +
	 * relative URLs resolve, or a stub in tests. Defaults to `globalThis.fetch`.
	 */
	fetch?: typeof globalThis.fetch;
	/**
	 * Credentials mode applied to every request. Wraps `fetch` since Connect-web
	 * has no top-level credentials option. Default `'same-origin'` (browser
	 * default); use `'include'` for cross-origin HttpOnly cookie sessions.
	 */
	credentials?: RequestCredentials;
	/** Connect interceptors (auth, tracing). Applied left-to-right. */
	interceptors?: readonly Interceptor[];
	/** Binary wire format. JSON (`false`, default) is inspectable in DevTools. */
	useBinaryFormat?: boolean;
}

/**
 * Builds a Connect-web HTTP {@link Transport} from {@link CreateClientOptions}.
 * Exported so callers that need the transport directly (e.g. `connect-query`)
 * can reuse the same `baseUrl` / `fetch` / credentials wiring.
 */
export function createTransport(options: CreateClientOptions): Transport {
	const { baseUrl, fetch: fetchImpl, credentials, interceptors, useBinaryFormat } = options;
	if (baseUrl === undefined) {
		throw new Error('createTransport requires a baseUrl (or pass an explicit transport)');
	}
	return createConnectTransport({
		baseUrl,
		useBinaryFormat: useBinaryFormat ?? false,
		fetch: withCredentialsFetch(fetchImpl ?? globalThis.fetch, credentials),
		...(interceptors !== undefined ? { interceptors: [...interceptors] } : {}),
	});
}

/**
 * Thin typed wrapper over `@connectrpc/connect`'s `createClient` bound to a
 * Connect-web transport. Generic over a `@bufbuild/protobuf`-generated
 * {@link DescService} descriptor, so the returned {@link Client} is fully typed
 * (unary → `Promise`, server-streaming → `AsyncIterable`).
 *
 * Pass `opts.transport` (a `createRouterTransport(...)`) in tests; otherwise a
 * transport is built from `baseUrl` + injectable `fetch` + `interceptors`.
 */
export function createClient<T extends DescService>(
	service: T,
	opts: CreateClientOptions,
): Client<T> {
	const transport = opts.transport ?? createTransport(opts);
	return createConnectClient(service, transport);
}

/**
 * Wraps a `fetch` so every request carries the given credentials mode. Returns
 * the original `fetch` unchanged when no mode is requested. Connect-web has no
 * top-level credentials option, so cookie sessions (`'include'`) are threaded
 * here. Exported for direct unit testing + reuse at custom transport call sites.
 */
export function withCredentialsFetch(
	fetchImpl: typeof globalThis.fetch,
	credentials: RequestCredentials | undefined,
): typeof globalThis.fetch {
	if (credentials === undefined) return fetchImpl;
	return (input, init) => fetchImpl(input, { ...init, credentials });
}

/**
 * Maps a Connect {@link Code} to a stable RFC 9457 problem-type URN, matching
 * the vocabulary in `docs/compose/connectrpc.md`. Codes without a dedicated
 * URN fall back to `urn:sveltesentio:rpc:<code-name>`.
 */
const CODE_TO_PROBLEM_TYPE: Partial<Record<Code, string>> = {
	[Code.InvalidArgument]: 'urn:sveltesentio:rpc:invalid_argument',
	[Code.NotFound]: 'urn:sveltesentio:rpc:not_found',
	[Code.AlreadyExists]: 'urn:sveltesentio:rpc:already_exists',
	[Code.PermissionDenied]: 'urn:sveltesentio:rpc:forbidden',
	[Code.Unauthenticated]: 'urn:sveltesentio:rpc:auth_required',
	[Code.ResourceExhausted]: 'urn:sveltesentio:rpc:rate_limited',
	[Code.Unavailable]: 'urn:sveltesentio:rpc:unavailable',
	[Code.DeadlineExceeded]: 'urn:sveltesentio:rpc:timeout',
};

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

/**
 * Converts a {@link ConnectError} into a core {@link ProblemError} so RPC and
 * REST surfaces share one error vocabulary (see `docs/compose/connectrpc.md`).
 * Non-`ConnectError` reasons are normalised via `ConnectError.from` first. The
 * mapping is opt-in: clients keep raising `ConnectError` by default; call this
 * at an error boundary where the unified `ProblemError` shape is wanted.
 */
export function connectErrorToProblem(reason: unknown): ProblemError {
	const err = ConnectError.from(reason);
	const type = CODE_TO_PROBLEM_TYPE[err.code] ?? `urn:sveltesentio:rpc:${codeName(err.code)}`;
	const correlationId = err.metadata.get('X-Correlation-Id');
	return new ProblemError({
		type,
		title: codeName(err.code),
		status: CODE_TO_HTTP_STATUS[err.code] ?? 500,
		detail: err.rawMessage,
		...(correlationId !== null ? { extensions: { correlationId } } : {}),
		cause: err,
	});
}

/** Lower-cased Connect code name (`NotFound` → `not_found`) for problem types. */
function codeName(code: Code): string {
	const name = Code[code] ?? 'unknown';
	return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}
