# HTTP client — `openapi-fetch` + RFC 9457

Every HTTP call to a Golusoris backend (or any RFC 9457-compliant service)
goes through an `openapi-fetch` client with sveltesentio's `ProblemError`
middleware. You get path-param autocomplete, typed query strings, and a
narrowed error object that matches the server's `application/problem+json`
envelope.

See [ADR-0019](../adr/0019-openapi-fetch-rfc9457.md) for the decision. API
lives in `@sveltesentio/core/http`.

## Install

```bash
pnpm add openapi-fetch
pnpm add -D openapi-typescript
```

Peer range: `openapi-fetch@^0.17`. Framework types come from `@sveltesentio/core`.

## Generate types

Generate once per backend spec change. Commit the output — it's source.

```bash
pnpm dlx openapi-typescript https://golusoris.example/openapi.json \
  --output src/lib/api/schema.ts
```

Re-run on every Golusoris minor (the spec is part of the Golusoris release
artifact).

## Wire the client

```ts
// src/lib/api/client.ts
import createClient, { type Middleware } from 'openapi-fetch';
import { problemMiddleware } from '@sveltesentio/core/http';
import type { paths } from './schema';

export const api = createClient<paths>({
  baseUrl: 'https://golusoris.example',
  // `credentials: 'include'` is framework default when the session cookie
  // lives on a different origin. Same-origin deployments (see
  // @sveltesentio/ipc-sockmap — ADR-0051) don't need this.
  credentials: 'include',
});

api.use(problemMiddleware());
```

`problemMiddleware()` is the only middleware most consumers need. It:

1. Inspects every non-2xx response.
2. If `content-type` is `application/problem+json`, parses the body with a
   Zod-narrowed discriminated union matching [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457)
   members (`type`, `title`, `status`, `detail`, `instance`, + known
   extensions like `invalid-params`).
3. Throws a typed `ProblemError` carrying the parsed envelope.
4. On parse failure (non-compliant server) wraps into `ProblemError` with
   `type: 'about:blank'` + raw response text preserved.

## Call + narrow

```ts
// +page.server.ts
import { api } from '$lib/api/client';
import { ProblemError } from '@sveltesentio/core/http';
import { error } from '@sveltejs/kit';

export async function load() {
  const { data, error: apiError } = await api.GET('/v1/users/{id}', {
    params: { path: { id: 'usr_01HX…' } },
  });

  if (apiError) {
    if (apiError instanceof ProblemError && apiError.status === 404) {
      error(404, apiError.title);
    }
    throw apiError;
  }

  return { user: data };
}
```

`data` and `apiError` are discriminated by response status — if `data` is
defined, `apiError` is `undefined`, and vice versa. `apiError` is always
`ProblemError | undefined` once the middleware is installed.

## Retries

Retries are **not** a default. RFC 9457 does not define retry semantics, and
silent retries mask bugs. Opt in per-call with an interceptor:

```ts
import { retryMiddleware } from '@sveltesentio/core/http';

// Only retry idempotent methods on transient 5xx + 429.
const retry = retryMiddleware({
  methods: ['GET', 'HEAD', 'OPTIONS'],
  statuses: [502, 503, 504, 429],
  attempts: 3,
  backoff: 'exponential-jitter', // 200ms / 500ms / 1.2s, ±20% jitter
});

api.use(retry);
```

`429` responses respect the `Retry-After` header when present — the
middleware reads it and delays accordingly.

## Idempotency-Key

For `POST` mutations that must be safe under retry, send an
`Idempotency-Key`:

```ts
import { uuidv7 } from '@sveltesentio/core/id';

const { data, error } = await api.POST('/v1/payments', {
  body: { amount: 1200, currency: 'EUR' },
  headers: { 'Idempotency-Key': uuidv7() },
});
```

Golusoris's `httpx/idempotency` middleware deduplicates using this header.
Combine with retries only when the server guarantees idempotency for the
key.

## Pairing with TanStack Query

`@sveltesentio/query` wraps `api.GET` calls into `createQuery` factories
with SSR hydration and automatic cache-key derivation. See
[server-state.md](server-state.md).

```ts
// lib/queries/users.ts
import { api } from '$lib/api/client';
import { createQuery } from '@sveltesentio/query';

export function userQuery(id: string) {
  return createQuery({
    queryKey: ['user', id] as const,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET('/v1/users/{id}', {
        params: { path: { id } },
        signal,
      });
      if (error) throw error;
      return data;
    },
  });
}
```

## ConnectRPC — not this client

For ConnectRPC endpoints (streaming, unary RPCs over `application/connect+*`),
use `@connectrpc/connect-web` through `@sveltesentio/realtime` — see
[ADR-0038](../adr/0038-connectrpc-connect-web-connect-query.md). Connect errors
are already typed via buf's generated service definitions; no middleware
needed.

Rule of thumb: **REST / OpenAPI 3.1 → `openapi-fetch`. RPC / proto →
ConnectRPC.** Don't mix within a single API surface.

## Testing

Use `@sveltesentio/testing`'s MSW helpers (planned) or a direct `fetch` mock:

```ts
import { vi } from 'vitest';

vi.stubGlobal('fetch', async (url: string) => {
  return new Response(
    JSON.stringify({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
    }),
    { status: 404, headers: { 'content-type': 'application/problem+json' } },
  );
});

const { data, error } = await api.GET('/v1/users/{id}', {
  params: { path: { id: 'x' } },
});
expect(error).toBeInstanceOf(ProblemError);
expect(error?.status).toBe(404);
```

## References

- ADR-0019 — decision + alternatives considered.
- ADR-0038 — ConnectRPC boundary.
- ADR-0023 — UUIDv7 for `Idempotency-Key`.
- RFC 9457 — Problem Details: <https://www.rfc-editor.org/rfc/rfc9457>.
- `openapi-fetch` docs: <https://openapi-ts.dev/openapi-fetch/>.
