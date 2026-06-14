# SSE — `useSSE()` over native `EventSource`

`@sveltesentio/realtime/sse` ships a thin runes wrapper over the native
browser `EventSource` per
[ADR-0037](../adr/0037-sse-native-useSSE.md). No `sveltekit-sse` framework
layer (zero adopters, framework over a 15-line wrapper). One transport
hook per semantics — no unified `useRealtime()` over SSE / ConnectRPC /
Yjs (each leaks differently).

This recipe documents `useSSE()` lifecycle, reconnection / `Last-Event-ID`
resume, the Safari connection limit, and when to switch transports.

Related: [server-state.md](server-state.md) (TanStack Query for poll vs
push), [http-client.md](http-client.md) (RFC 9457 errors).

## Install

```bash
pnpm add @sveltesentio/realtime
```

`useSSE()` lives at `@sveltesentio/realtime/sse`. No additional runtime
deps — `EventSource` is browser-native.

## Server contract

A SvelteKit `+server.ts` endpoint emits `text/event-stream`:

```ts
// src/routes/api/feed/+server.ts
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) => {
  const lastId = request.headers.get('Last-Event-ID');
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();

      const send = (data: unknown, id: string, event = 'message') => {
        controller.enqueue(enc.encode(
          `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
        ));
      };

      // Replay since lastId if present
      const since = lastId ? Number(lastId) : 0;
      for (const item of await fetchSince(since)) {
        send(item, String(item.seq));
      }

      // Live tail
      const sub = subscribe((item) => send(item, String(item.seq)));
      request.signal.addEventListener('abort', () => {
        sub.unsubscribe();
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',           // disable nginx proxy buffering
      Connection: 'keep-alive',
    },
  });
};
```

Three header invariants:

- `Cache-Control: no-cache, no-transform` — prevent any cache from
  buffering or transforming.
- `X-Accel-Buffering: no` — nginx-specific; disables proxy buffering
  that breaks streaming.
- `Connection: keep-alive` — required for HTTP/1.1; HTTP/2 ignores
  but harmless.

## `useSSE()` shape

```ts
// @sveltesentio/realtime/sse
export function useSSE<T = MessageEvent>(
  url: string,
  options?: {
    onMessage?: (e: MessageEvent) => void;
    onOpen?: (e: Event) => void;
    onError?: (e: Event) => void;
    auto?: boolean;                // default true: open on $effect mount
    backoff?: { initial: number; max: number; jitter: number };
    withCredentials?: boolean;     // for cross-origin cookies
  },
): {
  open(): void;
  close(): void;
  readonly readyState: 0 | 1 | 2;  // CONNECTING | OPEN | CLOSED
};
```

## Component pattern

```svelte
<script lang="ts">
  import { useSSE } from '@sveltesentio/realtime/sse';
  import { z } from 'zod';

  const FeedItem = z.object({
    id: z.string(),
    seq: z.number(),
    body: z.string(),
    ts: z.iso.datetime(),
  });

  let items = $state<z.infer<typeof FeedItem>[]>([]);

  const { readyState } = useSSE('/api/feed', {
    onMessage: (e) => {
      const parsed = FeedItem.safeParse(JSON.parse(e.data));
      if (parsed.success) items.push(parsed.data);
      else console.error('[sse] schema mismatch', parsed.error);
    },
    onError: () => {
      // EventSource auto-reconnects; surface only persistent failures
    },
    backoff: { initial: 1000, max: 30000, jitter: 0.3 },
  });
</script>

<ul role="log" aria-live="polite" aria-relevant="additions">
  {#each items as item (item.id)}
    <li>{item.body}</li>
  {/each}
</ul>

{#if readyState === 0}
  <span class="sr-only" role="status">Connecting…</span>
{:else if readyState === 2}
  <span role="status" class="text-warn">Reconnecting…</span>
{/if}
```

`role="log" aria-live="polite" aria-relevant="additions"` is the SR
contract for streaming feeds — additions announce, the rest stays
silent. Don't use `role="alert"` (every message becomes an
emergency).

## Schema validation at the boundary

`onMessage` hands you a raw `MessageEvent` — type-narrow with Zod
(see [schemas.md](schemas.md)). Never `JSON.parse → as T` without
runtime validation; SSE is an external boundary.

```ts
const Frame = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('insert'), item: FeedItem }),
  z.object({ kind: z.literal('delete'), id: z.string() }),
  z.object({ kind: z.literal('heartbeat') }),
]);

onMessage: (e) => {
  const f = Frame.parse(JSON.parse(e.data));
  switch (f.kind) {
    case 'insert': items.push(f.item); break;
    case 'delete': items = items.filter((i) => i.id !== f.id); break;
    case 'heartbeat': /* no-op */ break;
  }
}
```

Discriminated unions force exhaustive switch — adding a new `kind`
later breaks the type, not silently the runtime.

## `Last-Event-ID` resume

Browser `EventSource` automatically sends the last seen `id:` field
as `Last-Event-ID` on reconnect. Server replays from that point.
Wire from the example endpoint above.

Cap replay window — if the gap is huge (offline > 1 h), fall back
to a one-shot REST refresh + clear the buffer:

```ts
onOpen: async () => {
  if (lastSeenSeq === 0) return;
  const gap = await api.GET('/feed/gap-since', { params: { query: { seq: lastSeenSeq } } });
  if (gap.data?.tooLarge) {
    items = await api.GET('/feed/snapshot');
  }
},
```

## Heartbeats

Networks kill idle TCP sockets; SSE servers should emit a heartbeat
every 15-30 s:

```text
: heartbeat

```

Lines starting with `:` are comments — they keep the connection
alive but don't reach `onMessage`. Pair with browser-side timeout:

```ts
let lastSeen = Date.now();
onMessage: () => { lastSeen = Date.now(); };

setInterval(() => {
  if (Date.now() - lastSeen > 60_000) sse.close(); // forces reconnect
}, 30_000);
```

## Backoff + jitter

Native `EventSource` retries automatically with the server-suggested
`retry:` value (default 3 s). The wrapper layers exponential backoff
+ jitter on top to avoid thundering herd on server restarts:

```text
attempt 1: 1000ms ± 30%
attempt 2: 2000ms ± 30%
attempt 3: 4000ms ± 30%
…
attempt n: min(initial × 2^n, max=30000) ± jitter
```

Reset on successful `open`. Don't make the cap absurdly high — users
expect feeds to recover within a minute.

## Auth

`EventSource` sends cookies on same-origin by default. Cross-origin
needs `withCredentials: true`:

```ts
useSSE('/api/feed', { withCredentials: true });
```

Server must respond with `Access-Control-Allow-Credentials: true`
and a specific `Access-Control-Allow-Origin` (no `*`). HttpOnly
session cookie auth (see [auth-oidc.md](auth-oidc.md)) flows
naturally.

**Bearer tokens** are not supported by `EventSource` — no header
control. Two options:

1. Use cookies (preferred per ADR-0034).
2. Pass token as a query param + rotate (worse: tokens in logs).

If you need full header control, use `fetch` with streaming response
instead — but you've lost auto-reconnect + `Last-Event-ID`.

## Safari connection limit

Safari caps `EventSource` at **6 connections per origin**. With
multiple tabs / multiple feeds per page, you'll hit it. Mitigations:

- **HTTP/2 multiplexing.** Limit applies per HTTP/1.1 connection;
  HTTP/2 multiplexes them. Ensure your server / CDN serves H2.
- **Single SSE per page.** Multiplex multiple feeds inside one
  stream with discriminated `kind` field.
- **BroadcastChannel.** One tab opens the SSE; others receive via
  `BroadcastChannel`. Saves connections; complex.
- **Switch to WebSocket** for high-fan-out cases.

Document this trade-off in your ops runbook — it usually surprises
during scale-up.

## When to switch transports

| Need | Transport |
|---|---|
| Server → client only, infrequent | SSE (this recipe) |
| Server → client high-frequency (>10 Hz) | SSE still fine |
| Bidirectional typed RPC | ConnectRPC (ADR-0038) |
| Collaborative state (CRDT) | Yjs over WebSocket ([collab.md](collab.md)) |
| Bidirectional ad-hoc messages | WebSocket |

Don't reach for WebSocket because "it's bidirectional" — if the
client's only writes are auth + occasional command, a `POST` + SSE
read is simpler and HTTP-cacheable.

## Testing

```ts
import { useSSE } from '@sveltesentio/realtime/sse';

test('useSSE handles message + reconnect', async () => {
  const messages: string[] = [];
  const sse = useSSE('http://localhost:0/test', {
    onMessage: (e) => messages.push(e.data),
    auto: false,
  });

  // Mock EventSource via msw or a local test server
  await mockSSEServer.send('hello');
  await mockSSEServer.send('world');

  expect(messages).toEqual(['hello', 'world']);
});
```

Playwright integration: hit a real SSE endpoint, assert UI updates,
kill the connection mid-stream, assert reconnect + replay.

## Anti-patterns

- **`useSSE` without Zod parsing in `onMessage`.** External boundary
  without validation is the textbook XSS / type-confusion sink.
- **`role="alert"` on a feed.** Every message becomes an emergency
  for SR users. Use `role="log"` + `aria-live="polite"` +
  `aria-relevant="additions"`.
- **Reconnecting without `Last-Event-ID` resume.** Lost messages on
  every flake.
- **No heartbeat.** Idle TCP sockets get killed; users see "live"
  feeds that are actually dead.
- **Bearer-token-in-query.** Tokens leak to access logs. Cookies
  per ADR-0034.
- **One SSE per UI widget on the page.** Hits Safari's 6-conn cap
  fast. Multiplex into one stream.
- **`sveltekit-sse` framework dep.** Zero adopters; framework over
  a 15-line wrapper. ADR-0037 rejects.
- **Buffering the whole feed in `$state`.** Long-running streams
  OOM. Cap (last 500) or virtualize via [data-tables.md](data-tables.md).
- **`useSSE` from a server-side route.** SSE is client-side. Use
  `EventSource` polyfill never; the server emits, the client
  consumes.

## References

- ADR-0037 — native `EventSource` + `useSSE` (rejects sveltekit-sse).
- ADR-0034 — HttpOnly cookie sessions.
- ADR-0038 — ConnectRPC for bidi typed streaming.
- [collab.md](collab.md) — Yjs over WebSocket.
- [schemas.md](schemas.md) — Zod parsing at boundaries.
- [server-state.md](server-state.md) — TanStack Query for non-streaming.
- WHATWG `EventSource`: <https://html.spec.whatwg.org/multipage/server-sent-events.html>.
- MDN SSE: <https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events>.
