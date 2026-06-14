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

## 1. Generate types from your OpenAPI spec

`@sveltesentio/api` does not bundle a spec — point openapi-typescript at yours
(any OpenAPI 3.x producer; e.g. a Go ogen-emitted `openapi.yaml`):

```bash
pnpm openapi-typescript ./api/openapi/openapi.yaml -o ./src/lib/api/types.ts
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

MIT © lusoris
