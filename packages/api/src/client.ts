import createOpenapiClient, { type ClientOptions, type Middleware } from 'openapi-fetch';
import { problemMiddleware, type ProblemMiddlewareOptions } from '@sveltesentio/core/http';

export interface CreateClientOptions extends ClientOptions {
	/** Options forwarded to core's `problemMiddleware`; pass `false` to skip it. */
	problem?: ProblemMiddlewareOptions | false;
	/** Extra middlewares applied after the problem middleware. */
	middlewares?: readonly Middleware[];
}

/**
 * Create a type-safe openapi-fetch client that throws core's `ProblemError` on
 * `application/problem+json` responses (RFC 9457). Generate the `Paths` type
 * from your OpenAPI spec with openapi-typescript (see the package README), then:
 *
 * ```ts
 * import type { paths } from './api-types.js';
 * export const api = createClient<paths>({ baseUrl: PUBLIC_API_BASE_URL });
 * const { data } = await api.GET('/items/{id}', { params: { path: { id } }, fetch });
 * ```
 */
// `Paths` must match openapi-fetch's own `extends {}` constraint: openapi-typescript
// emits `paths` as an interface with no index signature, so a `Record<...>` bound
// rejects real generated types (and collapses openapi-fetch's PathsWithMethod to never).
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- intentional: mirror openapi-fetch's createClient<Paths extends {}>
export function createClient<Paths extends {}>(options: CreateClientOptions = {}) {
	const { problem, middlewares, ...clientOptions } = options;
	const client = createOpenapiClient<Paths>(clientOptions);
	if (problem !== false) client.use(problemMiddleware(problem ?? {}));
	for (const middleware of middlewares ?? []) client.use(middleware);
	return client;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- mirror openapi-fetch's Paths constraint
export type ApiClient<Paths extends {}> = ReturnType<typeof createClient<Paths>>;

export type { ClientOptions, Middleware } from 'openapi-fetch';
