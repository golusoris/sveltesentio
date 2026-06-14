/**
 * Server-side composition: a typed openapi-fetch client wired with core's
 * RFC 9457 `problemMiddleware` feeds resolvers into `@sveltesentio/query`'s
 * `serverPrefetch`, producing the dehydrated state a SvelteKit `+page.server.ts`
 * load hands to `<HydrationBoundary>`. This exercises the real SSR-prefetch shape
 * across the api/core + query boundary.
 *
 * INTEGRATION FINDING (see AGENTS.md): `@sveltesentio/api`'s `createClient`
 * constrains its generic to `Paths extends Record<string, Record<string, unknown>>`.
 * openapi-typescript emits `paths` as an `interface` with NO index signature, which
 * fails that constraint; adding an index signature collapses openapi-fetch's
 * `PathsWithMethod` to `never`, so typed path calls stop resolving. The two are
 * mutually exclusive. We therefore compose openapi-fetch + `@sveltesentio/core/http`
 * `problemMiddleware` directly here (exactly what `createClient` does internally,
 * minus the over-tight constraint) so the typed `GET` keeps full inference. The
 * `@sveltesentio/api` `createClient` runtime behaviour is still proven via
 * {@link sentioApiClientThrowsProblem}.
 */
import createOpenapiClient from 'openapi-fetch';
import type { Client } from 'openapi-fetch';
import { problemMiddleware } from '@sveltesentio/core/http';
import { createClient as createSentioApiClient } from '@sveltesentio/api';
import { serverPrefetch } from '@sveltesentio/query';
import type { DehydratedState } from '@sveltesentio/query';

/** Item returned by the demo `/items/{id}` endpoint. */
export interface Item {
	readonly id: string;
	readonly title: string;
}

/**
 * Minimal OpenAPI `paths` shape, matching what openapi-typescript emits
 * (an interface, no index signature). Normally generated; declared inline so the
 * integration consumer needs no codegen step.
 */
export interface DemoPaths {
	'/items/{id}': {
		get: {
			parameters: { path: { id: string } };
			responses: { 200: { content: { 'application/json': Item } } };
		};
	};
}

/** The concrete typed client type. */
export type DemoApiClient = Client<DemoPaths>;

/**
 * Build the typed client by composing openapi-fetch with core's `problemMiddleware`
 * (RFC 9457). `fetch` is injectable for SSR (`event.fetch`) + tests.
 */
export function createDemoClient(baseUrl: string, fetch?: typeof globalThis.fetch): DemoApiClient {
	const client = createOpenapiClient<DemoPaths>(fetch ? { baseUrl, fetch } : { baseUrl });
	client.use(problemMiddleware({}));
	return client;
}

/** Resolver wrapping the typed client; throws `ProblemError` on problem+json. */
export async function fetchItem(client: DemoApiClient, id: string): Promise<Item> {
	const { data } = await client.GET('/items/{id}', { params: { path: { id } } });
	if (data === undefined) {
		throw new Error(`item ${id} returned no body`);
	}
	return data;
}

/**
 * SSR load body: prefetch one item into a fresh query cache and dehydrate it.
 * Mirrors what a `+page.server.ts` returns as `data.dehydratedState`.
 */
export async function prefetchItemPage(
	client: DemoApiClient,
	id: string,
): Promise<{ dehydratedState: DehydratedState }> {
	return serverPrefetch({
		queries: [
			{
				queryKey: ['items', id],
				queryFn: () => fetchItem(client, id),
			},
		],
	});
}

/** Minimal structural view of the one client method we drive at runtime. */
interface PingableClient {
	GET(path: '/ping'): Promise<{ data?: unknown; error?: unknown }>;
}

/**
 * Proves `@sveltesentio/api`'s `createClient` export resolves at runtime and
 * throws core's `ProblemError` on `application/problem+json`.
 *
 * The generic is satisfied with an index-signature `paths` map (required by the
 * `Record<string, Record<string, unknown>>` constraint), which — per the finding
 * above — collapses openapi-fetch's `PathsWithMethod` to `never`, making the typed
 * `GET` uncallable. We therefore expose the runtime client through a minimal
 * structural {@link PingableClient} view (one documented cast) to drive + assert
 * the middleware behaviour without `any`.
 */
export function sentioApiClientThrowsProblem(fetch: typeof globalThis.fetch): PingableClient {
	const api = createSentioApiClient<Record<string, Record<string, unknown>>>({
		baseUrl: 'https://api.test',
		fetch,
	});
	// The constraint-satisfying generic erases the typed method surface; narrow to
	// the single method under test. `unknown` first so this is not an `any` cast.
	return api as unknown as PingableClient;
}
