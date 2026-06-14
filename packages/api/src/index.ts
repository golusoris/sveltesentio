// @sveltesentio/api — typed openapi-fetch client wired with core's RFC 9457
// problemMiddleware. Generate `paths` types from an OpenAPI spec with
// openapi-typescript (see README); pairs with @sveltesentio/query.
export { createClient } from './client.js';
export type { CreateClientOptions, ApiClient, ClientOptions, Middleware } from './client.js';
