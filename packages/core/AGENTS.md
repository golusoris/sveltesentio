# @sveltesentio/core — AGENTS.md

> Framework-level primitives that every other `@sveltesentio/*` package and downstream app consumes. Phase 2 per [.workingdir/PLAN.md](../../.workingdir/PLAN.md).

## Scope

- **Clock injection** — `setClock` / `useClock` / `getClock` / `withClock` / `createHydrationClock` / `systemClock` / `Clock` interface. See [ADR-0052](../../docs/adr/0052-clock-injection-hybrid.md) + [docs/compose/clock-injection.md](../../docs/compose/clock-injection.md).
- **Env schema** — `createEnv({ server, publicEnv, runtimeEnv })` Zod v4 validator, run once at server boot. Throws `EnvValidationError` with `z.treeifyError` tree on drift. See [ADR-0001](../../docs/adr/0001-zod-v4-floor.md).
- **Problem types** — RFC 9457 `problem+json` parser (`parseProblem` / `problemFromDocument` / `problemFromResponse` / `isProblemResponse`) + `ProblemError` class carrying `type` / `title` / `status` / `detail` / `instance` / `invalid-params` / extensions. See [ADR-0019](../../docs/adr/0019-openapi-fetch-rfc9457.md).
- **HTTP middleware** — `problemMiddleware()` for `openapi-fetch`; intercepts `application/problem+json` non-2xx responses and throws a typed `ProblemError`. `openapi-fetch` is an optional peer.
- **ID utils** — `newId()` (UUIDv7) / `newIdV4()` (nonces) / `isId` / `idToTimestamp` / `brandId<Brand>` over `uuid@^13`. See [ADR-0023](../../docs/adr/0023-uuid-v7-default.md).
- **CSP helpers** — `createNonce()` / `strictCsp({ nonce })` / `serialiseCsp()` / `nonceSource` / `hashSource` / `SELF` / `NONE` / `STRICT_DYNAMIC`. Strict default ships `script-src 'strict-dynamic' 'nonce-…'`, no `unsafe-*`, `upgrade-insecure-requests`, `frame-ancestors 'none'`.
- **Vite plugin** — `sentioPlugin({ requiredEnv, verbose, virtualModule })`. Validates required env at `buildStart`, exposes a typed `$sentio` virtual module at `resolveId` / `load`. ESLint rule registration + bundle-size gate are follow-through.

## Sub-exports

| Export | Module | Status |
|---|---|---|
| `@sveltesentio/core` | `src/index.ts` — re-exports every sub-export | v0.0.x |
| `@sveltesentio/core/clock` | `src/clock.ts` — clock injection | **shipped** (ADR-0052) |
| `@sveltesentio/core/env` | `src/env.ts` — `createEnv` / `requireEnv` / `EnvValidationError` | **shipped** (ADR-0001) |
| `@sveltesentio/core/id` | `src/id.ts` — `newId` / `newIdV4` / `brandId` / `idToTimestamp` | **shipped** (ADR-0023) |
| `@sveltesentio/core/problem` | `src/problem.ts` — `ProblemError` + RFC 9457 parser | **shipped** (ADR-0019) |
| `@sveltesentio/core/http` | `src/http.ts` — `problemMiddleware` for `openapi-fetch` | **shipped** (ADR-0019) |
| `@sveltesentio/core/csp` | `src/csp.ts` — nonce + directive builders | **shipped** |
| `@sveltesentio/core/vite` | `src/vite.ts` — `sentioPlugin` Vite hook | **shipped** |

Add a sub-export entry to `package.json` whenever a new module lands — never rely on deep imports.

## Invariants

- **No direct time reads.** `Date.now()` / `new Date()` / `performance.now()` are banned in source outside `test/`. Consumers route through the injected `Clock`. ESLint rule `@sveltesentio/no-direct-time`.
- **No `any`.** Use `unknown` + narrow via Zod or a type guard.
- **No module-level mutable state** that survives a request, except:
  - The browser-only `clientClock` singleton in `src/clock.ts` (one JS realm per tab — safe; documented in ADR-0052).
- **ESM-only** (ADR-0022). No `require`, no `module.exports`.
- **Node ≥ 24** (ADR-0021). Server code freely uses `AsyncLocalStorage` constructor options (`name`, `defaultValue`) added in Node 24.0.0.
- **Runes-first** (Svelte 5). Never `writable()` or `$:`; use `$state` / `$derived` / `$effect`.

## Test policy

- Unit tests live in `test/**/*.test.ts` (Vitest). Coverage thresholds 85/85/80/85 (statements/branches/functions/lines) in `vitest.config.ts`.
- **SSR hydration tests are mandatory for any feature that reads time or crosses the SSR boundary.** For clock: assert that the first `now()` on the browser equals the SSR `serverNow`, then advances on subsequent calls.
- `AsyncLocalStorage` tests run under Node ≥ 24; no browser polyfill.

## Known follow-through

- [ ] `testClock({ now })` helper in `@sveltesentio/testing/clock` — package not yet scaffolded. Tracked in [STATE.md](../../.workingdir/STATE.md).
- [ ] `@sveltesentio/no-direct-time` ESLint rule registration in the core Vite plugin.
- [ ] Bundle-size gate wired into `sentioPlugin` (rollup-plugin-visualizer-compatible).
- [ ] `$sentio` virtual module grows typed schema once downstream consumers settle the contents.

## Common tasks

| Task | Command |
|---|---|
| Typecheck | `pnpm --filter @sveltesentio/core typecheck` |
| Unit tests | `pnpm --filter @sveltesentio/core test` |
| Lint | `pnpm --filter @sveltesentio/core lint` |

## Related ADRs

- [ADR-0019](../../docs/adr/0019-openapi-fetch-rfc9457.md) — RFC 9457 middleware (core ships the parser, `openapi-fetch` binding lives elsewhere).
- [ADR-0020](../../docs/adr/0020-typescript-6-floor.md) — TypeScript 6 floor.
- [ADR-0021](../../docs/adr/0021-node-24-floor.md) — Node 24 floor.
- [ADR-0022](../../docs/adr/0022-esm-only.md) — ESM-only publish format.
- [ADR-0023](../../docs/adr/0023-uuid-v7-default.md) — UUIDv7 default.
- [ADR-0052](../../docs/adr/0052-clock-injection-hybrid.md) — clock injection.
