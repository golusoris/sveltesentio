# @sveltesentio/query — AGENTS.md

> TanStack Svelte Query integration: load helpers, SSR hydration, optimistic updates, pagination. Phase 4 per [.workingdir/PLAN.md](../../.workingdir/PLAN.md).

## Scope

Thin composition layer over `@tanstack/svelte-query@^6` (ADR-0008). This package enforces the framework's **"no `writable()` for server state"** rule by making TanStack Query the ergonomic default.

| Export | Purpose |
|---|---|
| `QueryClient` factory | Pre-configured client with RFC 9457 retry-on-typed-errors + monotonic-ID cache keys |
| `load` helpers | SSR prefetch into the cache so `+page.svelte` hydrates without a network round-trip |
| `useConnectQuery` / `createConnectQuery` | ConnectRPC bridge (`./connect`): a `queryFn` factory over a typed unary `Client<T>` method, with the v6 `Accessor<Options>` pattern + `ConnectError`→`ProblemError` retry integration ([ADR-0038](../../docs/adr/0038-connectrpc-connect-web-connect-query.md)) |
| `useInfiniteQuery` preset | Pagination patterns with cursor + offset variants; feeds `ui/data` virtual list |
| `useOptimistic` | Optimistic update helper with rollback on RFC 9457 typed error |

## Invariants

- **Never `writable()` for server state.** Any remote data goes through TanStack Query. Enforced by ESLint `no-restricted-imports` for `svelte/store` `writable` in new code (carve-outs are local UI state only, not fetched data).
- **Queries are typed via `openapi-fetch` / ConnectRPC** — no hand-written `fetch` + JSON decode. The raw-fetch pattern is a downstream antipattern (flagged in subdo row of [downstream-antipatterns-v0.1.md](../../docs/migrations/downstream-antipatterns-v0.1.md)).
- **SSR hydration mandatory.** `load` prefetch → `dehydrate` → `HydrationBoundary` in the root layout. First render shows data, not a loading spinner.
- **Typed errors surface as `ProblemError`** (RFC 9457, [ADR-0019](../../docs/adr/0019-openapi-fetch-rfc9457.md)) — retry policy keys off `error.type`, not status code.

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

`useConnectQuery` runs a typed unary RPC as a TanStack query. The Connect stack
(`@connectrpc/connect` + `@bufbuild/protobuf`) is an **optional peer** — the rest
of the package works without it. The bridge picks a unary method off an injected
`Client<T>`, forwards TanStack's abort `signal` into the call, and maps a thrown
`ConnectError` to a `ProblemError` (default `connectErrorToProblem`) so the shared
RFC 9457 retry policy keys off `error.status`. Pass
`@sveltesentio/realtime/rpc`'s richer `connectErrorToProblem` via `mapError` when
the curated URN vocabulary + correlation-id lifting is wanted (`query` does not
depend on `realtime`).

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

- Unit tests mock the transport, not TanStack Query itself — test query keys + cache behaviour, not the library.
- The ConnectRPC bridge unit-tests against a hand-built fake `Client` (no buf codegen): assert the `Accessor<Options>` shape + the `queryFn`'s call-forwarding and `ConnectError`→`ProblemError` mapping.
- SSR hydration assertions live in `@sveltesentio/testing`.

## Common tasks

| Task | Command |
|---|---|
| Typecheck | `pnpm --filter @sveltesentio/query typecheck` |
| Unit tests | `pnpm --filter @sveltesentio/query test` |

## Related ADRs

- [ADR-0008](../../docs/adr/0008-tanstack-svelte-query-v6.md) — `@tanstack/svelte-query@6` for server state.
- [ADR-0019](../../docs/adr/0019-openapi-fetch-rfc9457.md) — RFC 9457 typed errors.
- [ADR-0038](../../docs/adr/0038-connectrpc-connect-web-connect-query.md) — ConnectRPC integration.
- [ADR-0037](../../docs/adr/0037-sse-native-useSSE.md) — streaming transport (parallel, not overlapping).
