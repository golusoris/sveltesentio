# @sveltesentio/query — AGENTS.md

> TanStack Svelte Query integration: load helpers, SSR hydration, optimistic updates, pagination. Phase 4 per `.workingdir/PLAN.md`.

## Scope

Thin composition layer over `@tanstack/svelte-query@^6` (ADR-0008). Package enforces framework **"no `writable()` for server state"** rule via TanStack Query default.

| Export                                   | Purpose                                                                                                                                                                                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `QueryClient` factory                    | Pre-configured client with RFC 9457 retry-on-typed-errors + monotonic-ID cache keys                                                                                                                                                                     |
| `load` helpers                           | SSR prefetch into cache -> `+page.svelte` hydrates without network round-trip                                                                                                                                                                           |
| `useConnectQuery` / `createConnectQuery` | ConnectRPC bridge (`./connect`): `queryFn` factory over typed unary `Client<T>` method, with v6 `Accessor<Options>` pattern + `ConnectError`→`ProblemError` retry integration ([ADR-0038](../../docs/adr/0038-connectrpc-connect-web-connect-query.md)) |
| `useInfiniteQuery` preset                | Pagination patterns with cursor + offset variants; feeds `ui/data` virtual list                                                                                                                                                                         |
| `useOptimistic`                          | Optimistic update helper with rollback on RFC 9457 typed error                                                                                                                                                                                          |

## Invariants

- **Never `writable()` for server state.** Remote data goes through TanStack Query. Enforced by ESLint `no-restricted-imports` for `svelte/store` `writable` in new code (carve-outs: local UI state only, not fetched data).
- **Queries typed via `openapi-fetch` / ConnectRPC** — no hand-written `fetch` + JSON decode. Raw-fetch pattern flagged downstream antipattern (subdo row of [downstream-antipatterns-v0.1.md](../../docs/migrations/downstream-antipatterns-v0.1.md)).
- **SSR hydration mandatory.** `load` prefetch → `dehydrate` → `HydrationBoundary` in root layout. First render shows data, not loading spinner.
- **Typed errors surface as `ProblemError`** (RFC 9457, [ADR-0019](../../docs/adr/0019-openapi-fetch-rfc9457.md)) — retry policy keys off `error.type`, not status code.
- **Reactive keys use accessor form.** `createSentioQuery` / `createInfiniteItems` / `useConnectQuery` accept `options | (() => options)`. When `queryKey` derives from `$state`, pass `() => ({...})` -> accessor re-reads on every evaluation, TanStack refetches on key change. Plain-object form freezes key at call time (static keys only).
- **Index optional-peer-free.** `src/index.ts` must NOT re-export `connect-query` — imports optional `@connectrpc/connect` + `@bufbuild/protobuf` peers, breaks openapi-fetch-only builds. ConnectRPC bridge reachable only via `./connect` subpath.

## Canonical recipe

```ts
// +page.server.ts
import { dehydrate } from '@tanstack/svelte-query';
import { createQueryClient } from '@sveltesentio/query';
import { createClient } from '@sveltesentio/api';

export const load = async ({ fetch }) => {
  const qc = createQueryClient();
  const api = createClient({ fetch });
  await qc.prefetchQuery({
    queryKey: ['user', 'me'],
    queryFn: () => api.GET('/user/me').then((r) => r.data),
  });
  return { dehydratedState: dehydrate(qc) };
};
```

## ConnectRPC bridge (`./connect`)

`useConnectQuery` runs typed unary RPC as TanStack query. Connect stack (`@connectrpc/connect` + `@bufbuild/protobuf`) = **optional peer** — rest of package works without it. Bridge picks unary method off injected `Client<T>`, forwards TanStack abort `signal` into call, maps thrown `ConnectError` to `ProblemError` (default `connectErrorToProblem`) -> shared RFC 9457 retry policy keys off `error.status`. Pass `@sveltesentio/realtime/rpc` richer `connectErrorToProblem` via `mapError` when curated URN vocabulary + correlation-id lifting wanted (`query` does not depend on `realtime`).

```ts
import { useConnectQuery } from '@sveltesentio/query/connect';
import { createClient } from '@sveltesentio/realtime/rpc';
import { UserService } from './gen/user_pb';

const client = createClient(UserService, { baseUrl: '/api' });
const user = useConnectQuery({
  client,
  queryKey: ['user', id],
  call: (c, opts) => c.getUser({ id }, opts),
});
```

## Test policy

- Unit tests mock transport, not TanStack Query itself — test query keys + cache behaviour, not library.
- ConnectRPC bridge unit-tests against hand-built fake `Client` (no buf codegen): assert `Accessor<Options>` shape + `queryFn` call-forwarding + `ConnectError`→`ProblemError` mapping.
- SSR hydration assertions live in `@sveltesentio/testing`.

## Common tasks

| Task       | Command                                       |
| ---------- | --------------------------------------------- |
| Typecheck  | `pnpm --filter @sveltesentio/query typecheck` |
| Unit tests | `pnpm --filter @sveltesentio/query test`      |

## Related ADRs

- [ADR-0008](../../docs/adr/0008-tanstack-svelte-query-v6.md) — `@tanstack/svelte-query@6` for server state.
- [ADR-0019](../../docs/adr/0019-openapi-fetch-rfc9457.md) — RFC 9457 typed errors.
- [ADR-0038](../../docs/adr/0038-connectrpc-connect-web-connect-query.md) — ConnectRPC integration.
- [ADR-0037](../../docs/adr/0037-sse-native-useSSE.md) — streaming transport (parallel, not overlapping).
