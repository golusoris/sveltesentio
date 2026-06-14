# ConnectRPC — `@connectrpc/connect-web` + `@bufbuild/protobuf` + connect-query

`@sveltesentio/realtime/rpc` ships ConnectRPC against Golusoris per
[ADR-0038](../adr/0038-connectrpc-connect-web-connect-query.md). Three
pinned deps:

- `@connectrpc/connect-web@^2.1.1` — transport.
- `@bufbuild/protobuf@^2.11.0` — wire format + generated message types.
- `@connectrpc/connect-query@^2.2.0` — TanStack Query adapter.

Replaces the raw-`fetch` + hand-maintained types pattern that subdo
shipped (loses typed streams + structured errors).

This recipe documents the Buf codegen pipeline, transport wiring,
unary / server-stream / bidi patterns with runes, error handling,
auth, and the migration from raw fetch.

Related: [server-state.md](server-state.md) (TanStack Query),
[http-client.md](http-client.md) (REST + RFC 9457),
[sse.md](sse.md) (SSE alternative for server-only streaming),
[collab.md](collab.md) (Yjs WebSocket ownership).

## When to use ConnectRPC vs. alternatives

| Need | Tool |
|---|---|
| Typed RPC against Go (Golusoris) | ConnectRPC (this recipe) |
| Typed REST against any OpenAPI server | openapi-fetch ([http-client.md](http-client.md)) |
| Server-only push (no client send) | SSE ([sse.md](sse.md)) |
| Collaborative state | Yjs ([collab.md](collab.md)) |
| Ad-hoc JSON | `fetch` directly |

Don't reach for ConnectRPC unless the server is ConnectRPC-native.
The Buf codegen pipeline is overhead that pays off only when both
sides use protobuf schemas.

## Install

```bash
pnpm add @connectrpc/connect-web @bufbuild/protobuf @connectrpc/connect-query
pnpm add -D @bufbuild/buf @bufbuild/protoc-gen-es @connectrpc/protoc-gen-connect-es
```

`buf` is the codegen driver; the two `protoc-gen-*` plugins emit
TS message + service files.

## Buf codegen pipeline

Mirror Golusoris's proto layout under `proto/`:

```text
proto/
  buf.yaml
  buf.gen.yaml
  api/
    v1/
      feed_service.proto
      auth_service.proto
```

`proto/buf.gen.yaml`:

```yaml
version: v2
plugins:
  - local: protoc-gen-es
    out: src/lib/gen
    opt:
      - target=ts
      - import_extension=ts
  - local: protoc-gen-connect-es
    out: src/lib/gen
    opt:
      - target=ts
      - import_extension=ts
```

`package.json`:

```json
{
  "scripts": {
    "gen:proto": "buf generate proto",
    "gen:proto:check": "buf lint proto && buf format -d proto"
  }
}
```

CI runs `buf lint` + `buf format -d` on every PR — schemas are
contract surface, so style + breaking-change checks block merge.
Generated files (`src/lib/gen/`) are checked in; consumers get
working types without running buf locally.

## Transport configuration

```ts
// src/lib/rpc/transport.ts
import { createConnectTransport } from '@connectrpc/connect-web';

export const transport = createConnectTransport({
  baseUrl: import.meta.env.VITE_API_BASE,    // 'https://api.golusoris.dev'
  useBinaryFormat: false,                    // JSON in dev, binary in prod (see below)
  credentials: 'include',                    // HttpOnly cookies per ADR-0034
  interceptors: [authInterceptor, traceInterceptor],
});
```

Binary vs. JSON:

| Format | When | Trade-off |
|---|---|---|
| JSON | Dev / debugging | Inspectable in DevTools Network tab |
| Binary | Production | ~30% smaller, ~2× faster decode; opaque in DevTools |

Toggle via env: `useBinaryFormat: import.meta.env.PROD`.

## Client helper

```ts
// @sveltesentio/realtime/rpc
import { createPromiseClient } from '@connectrpc/connect';
import type { ServiceType } from '@bufbuild/protobuf';

export function createClient<T extends ServiceType>(
  service: T,
  opts: { transport: Transport },
) {
  return createPromiseClient(service, opts.transport);
}
```

Usage:

```ts
// src/lib/rpc/clients.ts
import { createClient } from '@sveltesentio/realtime/rpc';
import { transport } from './transport';
import { FeedService } from '$lib/gen/api/v1/feed_service_connect';

export const feed = createClient(FeedService, { transport });
```

## Unary calls — TanStack Query integration

Use `connect-query` over hand-rolling `useQuery`:

```svelte
<script lang="ts">
  import { createQuery } from '@connectrpc/connect-query';
  import { listItems } from '$lib/gen/api/v1/feed_service-FeedService_connectquery';

  const query = createQuery(listItems, { cursor: '' }, { transport });
</script>

{#if $query.isPending}
  <span role="status">Loading…</span>
{:else if $query.isError}
  <ProblemErrorView error={$query.error} />
{:else}
  <ul>
    {#each $query.data.items as item (item.id)}
      <li>{item.title}</li>
  {/each}
  </ul>
{/if}
```

`createQuery` returns a TanStack Query store keyed by the service +
method + input shape. Cache invalidation interop with the rest of
your QueryClient comes for free per [server-state.md](server-state.md).

## Server-stream — runes-native iteration

Server-stream methods return an `AsyncIterable<Output>`. Wrap with
runes to expose `$state`:

```ts
// @sveltesentio/realtime/rpc
export function useConnectStream<I, O>(
  method: (req: I) => AsyncIterable<O>,
  input: I,
  options?: { onError?: (e: Error) => void },
): {
  readonly items: readonly O[];
  readonly status: 'idle' | 'streaming' | 'closed' | 'error';
  start(): void;
  close(): void;
} {
  let items = $state<O[]>([]);
  let status = $state<'idle' | 'streaming' | 'closed' | 'error'>('idle');
  let abort: AbortController | null = null;

  async function start() {
    abort = new AbortController();
    status = 'streaming';
    try {
      for await (const msg of method(input)) {
        if (abort.signal.aborted) return;
        items.push(msg);
      }
      status = 'closed';
    } catch (err) {
      status = 'error';
      options?.onError?.(err as Error);
    }
  }

  function close() {
    abort?.abort();
    status = 'closed';
  }

  $effect(() => {
    start();
    return close;
  });

  return {
    get items() { return items; },
    get status() { return status; },
    start,
    close,
  };
}
```

Component:

```svelte
<script lang="ts">
  import { useConnectStream } from '@sveltesentio/realtime/rpc';
  import { feed } from '$lib/rpc/clients';

  const stream = useConnectStream(
    (input) => feed.tail(input),
    { since: 0n },
  );
</script>

<ul role="log" aria-live="polite" aria-relevant="additions">
  {#each stream.items as item (item.id)}
    <li>{item.body}</li>
  {/each}
</ul>

{#if stream.status === 'error'}
  <span role="status">Connection lost. Retrying…</span>
{/if}
```

`role="log" aria-live="polite" aria-relevant="additions"` — same SR
contract as [sse.md](sse.md). Streams are streams regardless of
transport.

## Bidi streams

Bidi requires HTTP/2 transport (or a dedicated `connect-node`-style
gateway). Browser support is HTTP/2-only:

```ts
const transport = createConnectTransport({
  baseUrl,
  useHttpGet: false,
  // bidi works iff the server speaks HTTP/2 and the browser negotiates it
});

const chat = await feed.chat();              // returns BidiStreamResponse

(async () => {
  for await (const reply of chat) {
    messages.push(reply);
  }
})();

await chat.send({ text: 'hi' });
```

If your CDN strips HTTP/2 trailers, bidi breaks silently. Test
against production headers, not just dev.

## Error handling — `ConnectError`

ConnectRPC errors carry a code + message + details:

```ts
import { ConnectError, Code } from '@connectrpc/connect';

try {
  await feed.delete({ id });
} catch (err) {
  if (err instanceof ConnectError) {
    if (err.code === Code.NotFound) toast.error('Already deleted');
    else if (err.code === Code.PermissionDenied) goto('/login');
    else throw err;
  }
}
```

Map ConnectRPC codes to RFC 9457 problem-types in your error
boundary so the rest of the app speaks one error vocabulary
(see [http-client.md](http-client.md)):

```ts
const codeToProblem: Record<number, string> = {
  [Code.NotFound]: 'urn:golusoris:not_found',
  [Code.PermissionDenied]: 'urn:golusoris:forbidden',
  [Code.Unauthenticated]: 'urn:golusoris:auth:required',
  [Code.ResourceExhausted]: 'urn:golusoris:rate_limited',
};
```

## Auth interceptor

Cookies (preferred per ADR-0034) flow automatically with
`credentials: 'include'`. Bearer tokens (when unavoidable, e.g.
mobile native bridges) ride on an interceptor:

```ts
const authInterceptor: Interceptor = (next) => async (req) => {
  const token = await getToken();
  if (token) req.header.set('Authorization', `Bearer ${token}`);
  return next(req);
};
```

Tokens come from server-issued session — never `localStorage` per
ADR-0034.

## Trace correlation

```ts
const traceInterceptor: Interceptor = (next) => async (req) => {
  const correlationId = crypto.randomUUID();
  req.header.set('X-Correlation-Id', correlationId);
  try {
    return await next(req);
  } catch (err) {
    if (err instanceof ConnectError) {
      err.metadata.set('X-Correlation-Id', correlationId);
    }
    throw err;
  }
};
```

UUIDv7 per ADR-0023 — but `crypto.randomUUID()` ships v4; use
`uuidv7()` from `@sveltesentio/core/id` if you need monotonic.

## Testing

Mock the transport, not `fetch`:

```ts
import { createRouterTransport } from '@connectrpc/connect';
import { FeedService } from '$lib/gen/...';

test('feed.list returns items', async () => {
  const transport = createRouterTransport(({ service }) => {
    service(FeedService, {
      list: () => ({ items: [{ id: '1', title: 'x' }] }),
    });
  });
  const client = createClient(FeedService, { transport });
  const out = await client.list({});
  expect(out.items).toHaveLength(1);
});
```

`createRouterTransport` is the supported test seam — it wires a
fake server-side router into the same transport interface, so
client code is exercised exactly as in production.

For streams:

```ts
service(FeedService, {
  tail: async function* () {
    yield { id: '1', body: 'a' };
    yield { id: '2', body: 'b' };
  },
});
```

## Migration from raw-`fetch` (subdo pattern)

Before:

```ts
const res = await fetch(`${API}/feed/list?cursor=${cursor}`, {
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
});
const json = await res.json() as ListItemsResponse;   // unsafe cast
```

After:

```ts
const out = await feed.list({ cursor });              // typed, validated
```

Mechanical migration:

1. `pnpm add @connectrpc/connect-web @bufbuild/protobuf` + dev deps.
2. Copy `proto/` from Golusoris (or sync via git submodule).
3. `pnpm gen:proto` — types appear in `src/lib/gen/`.
4. Replace each raw-`fetch` call site with the generated client.
5. Delete hand-maintained TS type aliases for response shapes.
6. Switch error-handling sites to `ConnectError`.
7. Run typecheck — drift in field shapes / nullability surfaces here.

Stage by service, not all at once. Each migration is a small PR with
a `Migration:` footer per CLAUDE.md.

## CSP

ConnectRPC binary uses `application/connect+proto` Content-Type —
no CSP impact, but if your server-side firewall filters by
Content-Type, allowlist it.

`connect-src` in CSP must include the API origin:

```text
connect-src 'self' https://api.golusoris.dev;
```

## Anti-patterns

- **Hand-maintained TS types for proto messages.** Drift bait.
  Generate from proto every build.
- **`fetch` against ConnectRPC endpoints.** Bypasses generated
  client → loses typed errors + streams. Migrate.
- **`ConnectError` ignored — re-thrown as generic `Error`.** Loses
  code → response-shape mapping. Always narrow on `Code`.
- **Storing tokens in `localStorage` for auth interceptor.** XSS
  exfiltrates everything; cookies per ADR-0034.
- **Skipping `buf lint` / `buf format -d` in CI.** Schema drift
  becomes runtime breakage.
- **Bidi streams without HTTP/2 verification.** CDN HTTP/1.1
  fallback silently breaks bidi. Test against prod headers.
- **`partysocket` as default WebSocket lib.** Held as
  `docs/compose/websocket.md` opt-in only — Yjs owns the WS lane
  per ADR-0009/0038.
- **Re-implementing TanStack Query around `createPromiseClient`.**
  `connect-query` is the supported adapter — use it.
- **Generated files outside `src/lib/gen/`.** Convention; downstream
  apps mirror it.
- **Binary format in dev.** Opaque in DevTools, kills debugging.
  JSON in dev, binary in prod.

## References

- ADR-0038 — `@connectrpc/connect-web` + protobuf + connect-query.
- ADR-0034 — HttpOnly cookie sessions.
- ADR-0023 — UUIDv7 correlation IDs.
- [server-state.md](server-state.md) — TanStack Query interop.
- [http-client.md](http-client.md) — RFC 9457 error mapping.
- [sse.md](sse.md) — SSE for server-only push.
- [collab.md](collab.md) — Yjs owns the WebSocket lane.
- ConnectRPC web docs: <https://connectrpc.com/docs/web/getting-started>.
- Buf docs: <https://buf.build/docs>.
