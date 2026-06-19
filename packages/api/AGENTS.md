# @sveltesentio/api — agent guide

Typed REST client layer: openapi-typescript codegen + an openapi-fetch wrapper
that applies core's RFC 9457 `problemMiddleware`. The decoupling target for
`@sveltesentio/query` (#69/#70) — query takes plain async resolvers; this package
is where the typed client lives.

## Landed (v0.1.0)

| Export | Purpose |
|---|---|
| `createClient<Paths>(options)` | openapi-fetch client; auto-applies `problemMiddleware` so problem+json throws `ProblemError`. `problem: false` opts out; `middlewares: []` adds more |
| `ApiClient<Paths>` | `ReturnType<typeof createClient<Paths>>` |
| re-exports | `ClientOptions`, `Middleware`, `PathsWithMethod` from openapi-fetch |
| `./codegen` → `generateTypes(deps, opts)` | wraps openapi-typescript (`openapiTS` + `astToString`, injected) → typed `paths` source with a generated banner; `runCodegen`/`parseCodegenArgs` drive the `sveltesentio-codegen` bin |
| `./auth-middleware` → `authMiddleware({ store, refresh })` | openapi-fetch Middleware preset: attaches a bearer token (injectable `TokenStore`) and refreshes once on 401, retrying the original request; refresh failures map to `ProblemError`. Add after `problemMiddleware` |

## Invariants

- **Never trust `File.type` / handwritten clients** — generate `paths` from the
  spec via openapi-typescript; the client is fully typed from there.
- **RFC 9457 by default** — problem responses throw `ProblemError` (from
  `@sveltesentio/core/http`). Compose with `@sveltesentio/query` retry and
  `@sveltesentio/forms` `problemToFieldErrors`.
- **Spec-agnostic** — any OpenAPI 3.x producer (Revenge's ogen `openapi.yaml` is
  one input). No spec is bundled.

## Notes

- **codegen is injectable.** `generateTypes`/`runCodegen` take their
  `openapiTS` + `astToString` + `writeFile` deps as arguments, so the logic is
  unit-tested without a real spec file or process. The `src/codegen-bin.ts`
  shell (shebang + real `node:fs` + lazily-imported openapi-typescript) is the
  only place the optional peer dep is touched; it is excluded from coverage.
- **auth ordering.** `createClient` applies `problemMiddleware` first, then any
  `middlewares`. Place `authMiddleware` in `middlewares` so a retried-but-still-
  401 response is normalised to `ProblemError` by the outer problem middleware.
  The retry is guarded by a per-request symbol so a still-401 retry never loops.
