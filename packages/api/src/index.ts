// @sveltesentio/api — typed openapi-fetch client wired with core's RFC 9457
// problemMiddleware. Generate `paths` types from an OpenAPI spec with
// openapi-typescript (see ./codegen); pairs with @sveltesentio/query.
export { createClient } from './client.js';
export type { CreateClientOptions, ApiClient, ClientOptions, Middleware } from './client.js';

export { generateTypes, runCodegen, parseCodegenArgs, GENERATED_BANNER } from './codegen.js';
export type {
	CodegenDeps,
	GenerateTypesOptions,
	CodegenCliDeps,
	CodegenCliResult,
} from './codegen.js';

export { authMiddleware } from './auth-middleware.js';
export type { AuthMiddlewareOptions, TokenStore } from './auth-middleware.js';
