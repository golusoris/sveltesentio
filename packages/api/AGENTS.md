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

## Invariants

- **Never trust `File.type` / handwritten clients** — generate `paths` from the
  spec via openapi-typescript; the client is fully typed from there.
- **RFC 9457 by default** — problem responses throw `ProblemError` (from
  `@sveltesentio/core/http`). Compose with `@sveltesentio/query` retry and
  `@sveltesentio/forms` `problemToFieldErrors`.
- **Spec-agnostic** — any OpenAPI 3.x producer (Revenge's ogen `openapi.yaml` is
  one input). No spec is bundled.

## Follow-through

- A `codegen` package script / generator that wraps openapi-typescript with
  sveltesentio defaults (currently a documented CLI recipe in the README).
- Auth/refresh middleware preset once the `auth` session-handoff shape is fixed.
