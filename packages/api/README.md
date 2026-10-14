# @sveltesentio/api

> Typed openapi-fetch client wired with core's RFC 9457 `problemMiddleware`

Part of the [sveltesentio](https://github.com/golusoris/sveltesentio) composable SvelteKit framework.

## Status

✅ v0.1.0 — `createClient` (openapi-fetch + `problemMiddleware`) and the
openapi-typescript codegen recipe. Pairs with `@sveltesentio/query`.

## Install

```bash
pnpm add @sveltesentio/api openapi-fetch
pnpm add -D openapi-typescript
```

## Sub-exports

| Import                              | What                                                                                                                                                                                                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@sveltesentio/api`                 | `createClient`, `generateTypes`, `runCodegen`, `parseCodegenArgs`, `GENERATED_BANNER` + types                                                                                                                                                        |
| `@sveltesentio/api/client`          | `createClient` alone                                                                                                                                                                                                                                 |
| `@sveltesentio/api/codegen`         | `generateTypes`, `runCodegen`, `parseCodegenArgs` — the openapi-typescript wrapper, separated so a runtime bundle never pulls the generator                                                                                                          |
| `@sveltesentio/api/auth-middleware` | `authMiddleware`, `TokenStore` — attaches a bearer token per request and, on a 401, refreshes once and retries. The store and refresh function are injected, so it composes with any session strategy; a failed refresh surfaces as a `ProblemError` |

## 1. Generate types from your OpenAPI spec

`@sveltesentio/api` does not bundle a spec — point openapi-typescript at yours
(any OpenAPI 3.x producer; e.g. a Go ogen-emitted `openapi.yaml`).

### Option A: Run the `openapi-typescript` CLI directly

```bash
pnpm exec openapi-typescript ./api/openapi/openapi.yaml -o ./src/lib/api/types.ts
```

### Option B: Call `runCodegen` from a project script

```ts
import { writeFile } from 'node:fs/promises';
import openapiTS, { astToString } from 'openapi-typescript';
import { runCodegen, type CodegenCliDeps } from '@sveltesentio/api/codegen';

const deps: CodegenCliDeps = {
  openapiTS: (source, options) => openapiTS(source, options),
  astToString: (ast) => astToString(ast as Parameters<typeof astToString>[0]),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  log: (msg) => console.error(msg),
};

await runCodegen(deps, process.argv.slice(2));
```

## 2. Create a client

```ts
import { createClient } from '@sveltesentio/api';
import type { paths } from './lib/api/types.js';
import { PUBLIC_API_BASE_URL } from '$env/static/public';

export const api = createClient<paths>({ baseUrl: PUBLIC_API_BASE_URL });

// In a load() — forward SvelteKit's fetch for SSR cookie/dedup support:
const { data } = await api.GET('/items/{id}', { params: { path: { id } }, fetch });
```

On any `application/problem+json` non-2xx response the call **throws** core's
`ProblemError` (RFC 9457), so `@sveltesentio/query`'s retry/optimistic helpers and
`@sveltesentio/forms`' `problemToFieldErrors` get a typed error. Pass
`problem: false` to disable, or `middlewares: [...]` to add your own (auth, tracing).

## License

EUPL-1.2 © lusoris. Releases up to and including 0.3.0 are MIT.
