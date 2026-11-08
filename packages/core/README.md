# @sveltesentio/core

> Core utilities — rune helpers, type-safe fetch, CSP hooks, error boundaries

Part of the [sveltesentio](https://github.com/golusoris/sveltesentio) composable SvelteKit framework.

## Status

✅ v0.1.0 — every entry point below has shipped. The table is the single list;
it is checked against `package.json` by the `Docs drift` CI job, so a second
enumeration here would only drift away from it.

## Requirements

**Zod v4 only.** `@sveltesentio/core` schemas require `zod@^4`
([ADR-0001](../../docs/adr/0001-zod-v4-floor.md)); **v3 is unsupported** — a v3 schema
breaks `createEnv` error reporting (`z.treeifyError`) and the `@sveltesentio/forms`
`zod4` adapter. Downstream apps on `zod@^3` must upgrade first; follow the
[Zod v3 → v4 migration guide](../../docs/migrations/zod-v3-to-v4.md).

## Installation

```bash
pnpm add @sveltesentio/core
```

## Entry points

Most of these are also re-exported from the package root, so `./clock`, `./csp`,
`./env`, `./id`, `./problem` and `./vite` can be imported either way. Three are
not interchangeable:

- `./http` is reachable **only** through the subpath — `problemMiddleware` is
  not re-exported from the root.
- `./sentio` is an ambient declaration, not a value.
- `./eslint` is re-exported from the root only as the `sentioEslint` plugin
  object and the `noDirectTime` rule; reach the other two rules through the
  plugin, or import the subpath.

| Subpath     | Provides                                                                                                                                 |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `.`         | The re-export surface for everything below.                                                                                              |
| `./clock`   | `Clock`, `useClock`, `getClock`, `setClock`, `withClock`, `createHydrationClock`, `systemClock` — the injected time seam.                |
| `./csp`     | `createNonce`, `nonceSource`, `hashSource`, `STRICT_DYNAMIC`, `SELF` and the `CspDirectives` types.                                      |
| `./env`     | `createEnv`, `requireEnv`, `EnvValidationError` — Zod-validated environment access.                                                      |
| `./eslint`  | The flat-config ESLint plugin. See below.                                                                                                |
| `./http`    | `problemMiddleware` — turns a thrown error into an RFC 9457 response.                                                                    |
| `./id`      | `newId` (UUIDv7), `newIdV4`, `isId`, `isIdV4`, `brandId`, `idToTimestamp`.                                                               |
| `./problem` | `ProblemError`, `parseProblem`, `problemFromDocument`, `problemFromResponse` — RFC 9457 Problem Details.                                 |
| `./sentio`  | Ambient declaration for the `$sentio` virtual module `sentioPlugin` emits. Add `"@sveltesentio/core/sentio"` to `compilerOptions.types`. |
| `./vite`    | `sentioPlugin` and `checkBundleBudget` — opt-in byte budgets per output file. See the note below.                                        |

`./vite` budgets are opt-in, and no build in this repository sets
`bundleBudget`, so the §2.9 initial-JS budget in
[`docs/principles.md`](../../docs/principles.md) is not gated yet
([#326](https://github.com/golusoris/sveltesentio/issues/326)). In
[`src/vite.ts`](src/vite.ts), a budget applies to every output file whose
`fileName` equals a key, chunks and assets alike, and the size checked is the
raw byte length, not the gzipped size §2.9 names. A file with no matching key
is not checked, so a stale or mistyped key passes without notice, and with
`bundleBudgetWarnOnly` an over-budget file warns instead of failing the build.
SvelteKit 3.1.0 names client entries `_app/immutable/[name].[hash].js` and
shared chunks `_app/immutable/chunks/[hash].js`
([source](https://github.com/sveltejs/kit/blob/73bf98cabea2ef18e1bfef40be5229a43e79b05c/packages/kit/src/exports/vite/build/index.js#L312-L320)),
so a fixed key cannot follow either from one build to the next.

### `./eslint`

A flat-config plugin bundling the three invariants that hold across packages.
Adopters enable them by rule name, so the names are the API:

| Rule                                | Reports                                                                                                                                                                                                                           |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@sveltesentio/no-direct-time`      | `Date.now()`, zero-argument `new Date()` and `performance.now()`. Time flows through the injected `Clock` so it stays deterministic and testable (ADR-0052).                                                                      |
| `@sveltesentio/chart-a11y-wrapper`  | A `layerchart` / `uplot` visual with no `<ChartFigure>` ancestor, so the WCAG 2.2 SC 1.1.1 text alternative cannot be skipped (ADR-0013).                                                                                         |
| `@sveltesentio/no-unsanitised-html` | Assignment to `innerHTML`, `outerHTML` or `insertAdjacentHTML` unless the value came from `sanitizeHtml(...)` or a `.sanitize(...)` call. Svelte's `{@html}` is covered by `svelte/no-at-html-tags`; this is the TypeScript side. |

```js
// eslint.config.js
import sentio from '@sveltesentio/core/eslint';

export default [
  {
    files: ['src/**/*.ts'],
    plugins: { '@sveltesentio': sentio },
    rules: {
      '@sveltesentio/no-direct-time': 'error',
      '@sveltesentio/no-unsanitised-html': 'error',
    },
  },
  {
    files: ['src/**/*.svelte'],
    plugins: { '@sveltesentio': sentio },
    rules: { '@sveltesentio/chart-a11y-wrapper': 'error' },
  },
];
```

Files that legitimately read ambient time — a clock implementation, a token TTL
stamp, an audit timestamp — belong in the config's `ignores` rather than
carrying an inline disable, so the exemption is reviewable in one place.

See the [monorepo README](../../README.md) and [`docs/`](../../docs/) for design principles and usage.

## License

EUPL-1.2 © lusoris. Releases up to and including 0.3.0 are MIT.
