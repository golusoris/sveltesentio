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
export function createClient<Paths extends Record<string, Record<string, unknown>>>(
	options: CreateClientOptions = {},
) {
	const { problem, middlewares, ...clientOptions } = options;
	const client = createOpenapiClient<Paths>(clientOptions);
	if (problem !== false) client.use(problemMiddleware(problem ?? {}));
	for (const middleware of middlewares ?? []) client.use(middleware);
	return client;
}

export type ApiClient<Paths extends Record<string, Record<string, unknown>>> = ReturnType<
	typeof createClient<Paths>
>;

export type { ClientOptions, Middleware } from 'openapi-fetch';
