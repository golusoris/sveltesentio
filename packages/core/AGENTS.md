# @sveltesentio/core — AGENTS.md

> Framework-level primitives that every other `@sveltesentio/*` package and downstream app consumes. Phase 2 per `.workingdir/PLAN.md`.

## Scope

- **Clock injection** — `setClock` / `useClock` / `getClock` / `withClock` / `createHydrationClock` / `systemClock` / `Clock` interface. See [ADR-0052](../../docs/adr/0052-clock-injection-hybrid.md) + [docs/compose/clock-injection.md](../../docs/compose/clock-injection.md).
- **Env schema** — `createEnv({ server, publicEnv, runtimeEnv })` Zod v4 validator, run once at server boot. Throws `EnvValidationError` with `z.treeifyError` tree on drift. See [ADR-0001](../../docs/adr/0001-zod-v4-floor.md).
- **Problem types** — RFC 9457 `problem+json` parser (`parseProblem` / `problemFromDocument` / `problemFromResponse` / `isProblemResponse`) + `ProblemError` class carrying `type` / `title` / `status` / `detail` / `instance` / `invalid-params` / extensions. See [ADR-0019](../../docs/adr/0019-openapi-fetch-rfc9457.md).
- **HTTP middleware** — `problemMiddleware()` for `openapi-fetch`; intercepts `application/problem+json` non-2xx responses; throws typed `ProblemError`. `openapi-fetch` = optional peer.
- **ID utils** — `newId()` (UUIDv7) / `newIdV4()` (nonces) / `isId` / `idToTimestamp` / `brandId<Brand>` over `uuid@^13`. See [ADR-0023](../../docs/adr/0023-uuid-v7-default.md).
- **CSP helpers** — `createNonce()` / `strictCsp({ nonce })` / `serialiseCsp()` / `nonceSource` / `hashSource` / `SELF` / `NONE` / `STRICT_DYNAMIC`. Strict default ships `script-src 'strict-dynamic' 'nonce-…'`, no `unsafe-*`, `upgrade-insecure-requests`, `frame-ancestors 'none'`.
- **Vite plugin** — `sentioPlugin({ requiredEnv, verbose, virtualModule, bundleBudget, bundleBudgetWarnOnly })`. Validates required env at `buildStart`. Exposes typed `$sentio` virtual module at `resolveId` / `load`. Enforces per-chunk size budgets at `generateBundle` (§2.9). `bundleBudget` = `{ [fileName]: maxBytes }` map; over-budget chunks throw (or warn when `bundleBudgetWarnOnly`). Budget logic = pure, exported `checkBundleBudget(bundle, budget)`.
- **ESLint plugin** — `@sveltesentio/core/eslint` exports flat-config plugin (`{ meta, rules: { 'no-direct-time': … } }`) enforcing no-direct-time invariant. See Sub-exports + Invariants.

## Sub-exports

| Export                       | Module                                                                                                                                                           | Status                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `@sveltesentio/core`         | `src/index.ts` — re-exports every sub-export                                                                                                                     | v0.0.x                 |
| `@sveltesentio/core/clock`   | `src/clock.ts` — clock injection                                                                                                                                 | **shipped** (ADR-0052) |
| `@sveltesentio/core/env`     | `src/env.ts` — `createEnv` / `requireEnv` / `EnvValidationError`                                                                                                 | **shipped** (ADR-0001) |
| `@sveltesentio/core/id`      | `src/id.ts` — `newId` / `newIdV4` / `brandId` / `idToTimestamp`                                                                                                  | **shipped** (ADR-0023) |
| `@sveltesentio/core/problem` | `src/problem.ts` — `ProblemError` + RFC 9457 parser                                                                                                              | **shipped** (ADR-0019) |
| `@sveltesentio/core/http`    | `src/http.ts` — `problemMiddleware` for `openapi-fetch`                                                                                                          | **shipped** (ADR-0019) |
| `@sveltesentio/core/csp`     | `src/csp.ts` — nonce + directive builders                                                                                                                        | **shipped**            |
| `@sveltesentio/core/vite`    | `src/vite.ts` — `sentioPlugin` Vite hook + `checkBundleBudget`                                                                                                   | **shipped**            |
| `@sveltesentio/core/eslint`  | `src/eslint.ts` — `no-direct-time` flat-config plugin                                                                                                            | **shipped**            |
| `@sveltesentio/core/sentio`  | `sentio.d.ts` — ambient types for `$sentio` virtual module (`defineSentioConfig` / `sentioConfigSchema` live in `src/sentio-config.ts`, re-exported from barrel) | **shipped** (0.3.0)    |

Add sub-export entry to `package.json` whenever new module lands — never rely on deep imports.

## Invariants

- **No direct time reads.** `Date.now()` / argument-less `new Date()` / `performance.now()` banned in source outside `test/`. Consumers route through injected `Clock`. Enforced by ESLint rule `@sveltesentio/no-direct-time`, shipped from `@sveltesentio/core/eslint`. `clock.ts` itself = sanctioned `systemClock` root; exempt. Register in flat config (TS config, since plugin re-exports `.ts` source):

  ```ts
  // eslint.config.ts
  import sentio from '@sveltesentio/core/eslint';
  export default [
  	{
  		files: ['packages/*/src/**/*.ts'],
  		ignores: ['packages/core/src/clock.ts'],
  		plugins: { '@sveltesentio': sentio },
  		rules: { '@sveltesentio/no-direct-time': 'error' },
  	},
  ];
  ```

- **No `any`.** Use `unknown` + narrow via Zod or type guard.
- **No module-level mutable state** surviving request, except:
  - Browser-only `clientClock` singleton in `src/clock.ts` (1 JS realm per tab — safe; documented in ADR-0052).
- **ESM-only** (ADR-0022). No `require`, no `module.exports`.
- **Node ≥ 24** (ADR-0021). Server code freely uses `AsyncLocalStorage` constructor options (`name`, `defaultValue`) added in Node 24.0.0.
- **Runes-first** (Svelte 5). Never `writable()` or `$:`; use `$state` / `$derived` / `$effect`.

## Test policy

- Unit tests live in `test/**/*.test.ts` (Vitest). Coverage thresholds 85/85/80/85 (statements/branches/functions/lines) in `vitest.config.ts`.
- **SSR hydration tests mandatory for feature reading time or crossing SSR boundary.** For clock: assert first `now()` on browser equals SSR `serverNow`, then advances on subsequent calls.
- `AsyncLocalStorage` tests run under Node ≥ 24; no browser polyfill.

## Known follow-through

- [ ] `testClock({ now })` helper in `@sveltesentio/testing/clock` — package not yet scaffolded. Tracked in `.workingdir/STATE.md`.
- [x] `@sveltesentio/no-direct-time` ESLint rule — shipped as `@sveltesentio/core/eslint` flat-config plugin (`rules: { 'no-direct-time' }`); register in `eslint.config.js`.
- [x] Bundle-size gate wired into `sentioPlugin` (`bundleBudget` / `bundleBudgetWarnOnly`; `generateBundle` hook).
- [x] `$sentio` virtual module typed schema shipped in 0.3.0 — `defineSentioConfig` / `sentioConfigSchema` + `./sentio` ambient-types subpath (`sentio.d.ts`).

## Common tasks

| Task       | Command                                      |
| ---------- | -------------------------------------------- |
| Typecheck  | `pnpm --filter @sveltesentio/core typecheck` |
| Unit tests | `pnpm --filter @sveltesentio/core test`      |
| Lint       | `pnpm --filter @sveltesentio/core lint`      |

## Related ADRs

- [ADR-0019](../../docs/adr/0019-openapi-fetch-rfc9457.md) — RFC 9457 middleware (core ships the parser, `openapi-fetch` binding lives elsewhere).
- [ADR-0020](../../docs/adr/0020-typescript-6-floor.md) — TypeScript 6 floor.
- [ADR-0021](../../docs/adr/0021-node-24-floor.md) — Node 24 floor.
- [ADR-0022](../../docs/adr/0022-esm-only.md) — ESM-only publish format.
- [ADR-0023](../../docs/adr/0023-uuid-v7-default.md) — UUIDv7 default.
- [ADR-0052](../../docs/adr/0052-clock-injection-hybrid.md) — clock injection.
