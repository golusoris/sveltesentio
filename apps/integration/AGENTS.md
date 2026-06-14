# @sveltesentio/integration — agent guide

Private, **non-published** integration-consumer (issue #30). Imports the public
`@sveltesentio/*` workspace packages exactly as a downstream SvelteKit app would
and proves they compose + typecheck + run together. This is a verification
artifact, not a deployable app: `private: true`, `version 0.0.0`, never in the
release config.

Run `tsc --noEmit` + `vitest run` here on every package change to catch
cross-package integration regressions the per-package suites cannot see (each
package's tsconfig only `include`s `src/**`, so its own `test/**` is never
typechecked — only transpiled by vitest).

## Modules (`src/`)

| Module | Composes | Proves |
|---|---|---|
| `server-prefetch.ts` | openapi-fetch + `core/http` `problemMiddleware` + `query` `serverPrefetch` | SSR prefetch dehydrates a typed `GET` result; problem+json throws `ProblemError` |
| `signup-form.ts` | `forms` `superValidate` + zod v4 + `forms` `problemToFieldErrors` + `core` `ProblemError` | a real zod/v4 schema validates; server `ProblemError` maps to field errors |
| `client-dashboard.ts` | `query` `createSentioQuery`/`useOptimistic` + `ui/tokens` + `ui/presets` + `ui/cmd` | typed query/mutation factories compose; theme+preset CSS emits; command registry search works |
| `auth-flow.ts` | `auth` `buildAuthorizationUrl` + `handleCsrf`/`evaluateCsrf` | PKCE authorization URL assembles; CSRF double-submit policy decides correctly |
| `live-feed.ts` | `realtime` `SseClient` + `computeBackoff` | SSE client connects via an injected transport; backoff curve grows within bounds |

## Tests (`test/`)

25 tests, all green. They CALL the pure/composable bits (not just typecheck):
`buildAuthorizationUrl` produces a valid URL, the api client throws `ProblemError`
on problem+json via an injected fetch, the ui command registry search ranks
results, the forms schema validates, `serverPrefetch` dehydrates, `evaluateCsrf`
returns the right rejection reason.

`test/mocks/app-*.ts` stub SvelteKit's `$app/*` virtual modules (see findings
below); `vitest.config.ts` aliases them and loads the svelte plugin so the
`.svelte` re-exports in the `query`/`forms` barrels resolve under vitest.

## Integration findings (the point of this package)

1. **`@sveltesentio/api` `createClient` generic constraint is unusable with typed
   path calls.** `createClient<Paths extends Record<string, Record<string, unknown>>>`
   cannot be satisfied by real openapi-typescript output: that codegen emits
   `paths` as an `interface` with **no** index signature (fails the constraint),
   and adding an index signature collapses openapi-fetch's `PathsWithMethod` to
   `never` (typed `GET`/`POST` stop resolving). The two requirements are mutually
   exclusive. `server-prefetch.ts` therefore composes openapi-fetch +
   `core/http` `problemMiddleware` directly for the typed path (identical runtime
   to `createClient`, minus the constraint), and exercises `createClient`'s
   runtime throw-behaviour through a narrowed structural view. **Recommended fix:**
   relax `createClient`'s generic to openapi-fetch's own `Paths extends {}` (or
   drop the constraint), so generated `paths` interfaces work as documented.

2. **`@sveltesentio/forms` barrel drags the entire SvelteKit client runtime into
   any consumer.** The barrel does `export { ... } from 'sveltekit-superforms'`
   (the client entry), which statically imports `SuperDebug.svelte` + the client
   `superForm`, pulling in `$app/environment`, `$app/stores`, `$app/navigation`,
   and `$app/forms`. A non-Kit context (vitest, node script, any server-only
   consumer that only needs `superValidate`) must stub all four virtual modules.
   **Recommended fix:** expose a server-safe subpath (e.g. `@sveltesentio/forms/server`)
   that re-exports only `superValidate` + types without the client surface.

3. **`@sveltesentio/query` barrel re-exports `.svelte` components**
   (`HydrationBoundary`, `QueryClientProvider`), so any tool loading the barrel
   needs the svelte plugin even when only the pure `serverPrefetch`/`createSentioQuery`
   functions are used. Tolerable (a SvelteKit app always has the plugin), but a
   plain-`.ts`-only subpath would let server tooling import `serverPrefetch`
   without a svelte transform.

4. **`serverPrefetch` does not dehydrate failed (problem) prefetches.**
   `prefetchQuery` swallows the rejection and TanStack's default
   `shouldDehydrateQuery` excludes errored queries, so a problem prefetch yields
   an EMPTY dehydrated state and the client refetches on mount. Expected TanStack
   behaviour — documented here so app authors don't expect the error to hydrate.

Everything else composed as documented: `core` `ProblemError`, `auth`
`buildAuthorizationUrl`/`evaluateCsrf`, `ui` tokens/presets/cmd-registry, and
`realtime` `SseClient`/`computeBackoff` all integrated with zero friction.
