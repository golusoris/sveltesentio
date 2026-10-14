# @sveltesentio/api — agent guide

Typed REST client layer: openapi-typescript codegen + openapi-fetch wrapper.
Applies core RFC 9457 `problemMiddleware`.
Decoupling target for `@sveltesentio/query` (#69/#70) — query takes plain async resolvers; typed client lives here.

## Landed (v0.1.0)

| Export                                                     | Purpose                                                                                                                                                                                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createClient<Paths>(options)`                             | openapi-fetch client; auto-applies `problemMiddleware` so problem+json throws `ProblemError`. `problem: false` opts out; `middlewares: []` adds more                                                         |
| `ApiClient<Paths>`                                         | `ReturnType<typeof createClient<Paths>>`                                                                                                                                                                     |
| re-exports                                                 | `ClientOptions`, `Middleware`, `PathsWithMethod` from openapi-fetch                                                                                                                                          |
| `./codegen` → `generateTypes(deps, opts)`                  | wraps openapi-typescript (`openapiTS` + `astToString`, injected) → typed `paths` source with generated banner; `runCodegen`/`parseCodegenArgs` drive codegen scripts                                         |
| `./auth-middleware` → `authMiddleware({ store, refresh })` | openapi-fetch Middleware preset: attaches bearer token (injectable `TokenStore`) and refreshes once on 401, retrying original request; refresh failures map to `ProblemError`. Add after `problemMiddleware` |

## Invariants

- **Never trust `File.type` / handwritten clients** — generate `paths` from spec via openapi-typescript; client fully typed from there.
- **RFC 9457 by default** — problem responses throw `ProblemError` (from `@sveltesentio/core/http`). Compose with `@sveltesentio/query` retry + `@sveltesentio/forms` `problemToFieldErrors`.
- **Spec-agnostic** — any OpenAPI 3.x producer (Revenge ogen `openapi.yaml` = 1 input). No spec bundled.

## Notes

- **codegen paths.** Two working patterns:
  1. CLI direct: `pnpm exec openapi-typescript <spec> -o <out.ts>`.
  2. Script wrapper: call `runCodegen(deps, argv)` with injected `openapiTS`, `astToString`, `writeFile` (`CodegenCliDeps`). Unit-tested without real spec file or process.
- **auth ordering.** `createClient` applies `problemMiddleware` first, then `middlewares`. Place `authMiddleware` in `middlewares` -> retried-but-still-401 response normalised to `ProblemError` by outer problem middleware. Retry guarded by per-request symbol -> still-401 retry never loops.
