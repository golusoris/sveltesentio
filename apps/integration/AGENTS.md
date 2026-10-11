# @sveltesentio/integration — agent guide

Private, **non-published** integration-consumer (issue #30).
Imports public `@sveltesentio/*` workspace packages exactly as downstream SvelteKit app would.
Proves packages compose + typecheck + run together.
Verification artifact, not deployable app: `private: true`, `version 0.0.0`, never in release config.

Run `tsc --noEmit` + `vitest run` on every package change.
Catches cross-package integration regressions per-package suites cannot see.
Reason: each package tsconfig only `include`s `src/**`.
`test/**` never typechecked — only transpiled by vitest.

## Modules (`src/`)

| Module                | Composes                                                                                  | Proves                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `server-prefetch.ts`  | openapi-fetch + `core/http` `problemMiddleware` + `query` `serverPrefetch`                | SSR prefetch dehydrates a typed `GET` result; problem+json throws `ProblemError`              |
| `signup-form.ts`      | `forms` `superValidate` + zod v4 + `forms` `problemToFieldErrors` + `core` `ProblemError` | a real zod/v4 schema validates; server `ProblemError` maps to field errors                    |
| `client-dashboard.ts` | `query` `createSentioQuery`/`useOptimistic` + `ui/tokens` + `ui/presets` + `ui/cmd`       | typed query/mutation factories compose; theme+preset CSS emits; command registry search works |
| `auth-flow.ts`        | `auth` `buildAuthorizationUrl` + `handleCsrf`/`evaluateCsrf`                              | PKCE authorization URL assembles; CSRF double-submit policy decides correctly                 |
| `live-feed.ts`        | `realtime` `SseClient` + `computeBackoff`                                                 | SSE client connects via an injected transport; backoff curve grows within bounds              |

## Tests (`test/`)

25 tests, all green.
Tests CALL pure/composable parts (not typecheck only):

- `buildAuthorizationUrl` produces valid URL.
- api client throws `ProblemError` on problem+json via injected fetch.
- ui command registry search ranks results.
- forms schema validates.
- `serverPrefetch` dehydrates.
- `evaluateCsrf` returns right rejection reason.

`test/mocks/app-*.ts` stub SvelteKit `$app/*` virtual modules (see findings below).
`vitest.config.ts` aliases stubs + loads svelte plugin.
Reason: `.svelte` re-exports in `query`/`forms` barrels resolve under vitest.

## Integration findings (the point of this package)

1. **`@sveltesentio/api` `createClient` generic constraint unusable with typed path calls.**
   `createClient<Paths extends Record<string, Record<string, unknown>>>` cannot be satisfied by real openapi-typescript output.
   Codegen emits `paths` as `interface` with **no** index signature (fails constraint).
   Adding index signature collapses openapi-fetch `PathsWithMethod` to `never` (typed `GET`/`POST` stop resolving).
   Two requirements mutually exclusive.
   `server-prefetch.ts` composes openapi-fetch + `core/http` `problemMiddleware` directly for typed path.
   Runtime identical to `createClient`, minus constraint.
   Exercises `createClient` runtime throw-behaviour through narrowed structural view.
   **Recommended fix:** relax `createClient` generic to openapi-fetch own `Paths extends {}` (or drop constraint) -> generated `paths` interfaces work as documented.

2. **`@sveltesentio/forms` barrel drags entire SvelteKit client runtime into consumer.**
   Barrel has `export { ... } from 'sveltekit-superforms'` (client entry).
   Statically imports `SuperDebug.svelte` + client `superForm`.
   Pulls in `$app/environment`, `$app/stores`, `$app/navigation`, `$app/forms`.
   Non-Kit context (vitest, node script, server-only consumer needing only `superValidate`) must stub all 4 virtual modules.
   **Recommended fix:** expose server-safe subpath (e.g. `@sveltesentio/forms/server`) re-exporting only `superValidate` + types without client surface.

3. **`@sveltesentio/query` barrel re-exports `.svelte` components.**
   `HydrationBoundary`, `QueryClientProvider` re-exported in barrel.
   Tool loading barrel requires svelte plugin even when using only pure `serverPrefetch`/`createSentioQuery` functions.
   Tolerable: SvelteKit app always has plugin.
   Plain-`.ts`-only subpath allows server tooling import of `serverPrefetch` without svelte transform.

4. **`serverPrefetch` does not dehydrate failed (problem) prefetches.**
   `prefetchQuery` swallows rejection.
   TanStack default `shouldDehydrateQuery` excludes errored queries.
   Problem prefetch yields EMPTY dehydrated state -> client refetches on mount.
   Expected TanStack behaviour — documented here so app authors do not expect error to hydrate.

Everything else composed as documented:
`core` `ProblemError`, `auth` `buildAuthorizationUrl`/`evaluateCsrf`, `ui` tokens/presets/cmd-registry, `realtime` `SseClient`/`computeBackoff` integrated with zero friction.
