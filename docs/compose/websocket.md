# WebSocket — `partysocket` opt-in for ad-hoc bidirectional messaging

`partysocket@^1` (PartyKit, ISC) is a thin reconnecting-WebSocket
client with backoff, heartbeat, and queueing. Held opt-in per
[ADR-0038](../adr/0038-connectrpc-connect-web-connect-query.md) D72
because:

- Yjs already owns the WebSocket lane via `y-websocket`
  ([collab.md](collab.md)).
- ConnectRPC bidi covers typed RPC streaming
  ([connectrpc.md](connectrpc.md)).
- SSE covers server → client push ([sse.md](sse.md)).

`partysocket` only earns its bundle when the app needs **ad-hoc
bidirectional JSON messages** that don't fit the typed-RPC, CRDT,
or SSE patterns — chat with custom protocol, presence-only channels,
game-style realtime, third-party WebSocket bridges.

This recipe documents when to reach for `partysocket`, the
runes-friendly `useWebSocket()` wrapper, message-protocol design,
auth, and the migration paths from raw `WebSocket`.

Related: [collab.md](collab.md) (Yjs over WS — preferred for
collaborative state), [connectrpc.md](connectrpc.md) (typed bidi RPC),
[sse.md](sse.md) (server-only push), [schemas.md](schemas.md)
(Zod boundary), [observability.md](observability.md)
(WebSocket span instrumentation).

## When to use `partysocket`

| Need | Tool |
|---|---|
| Collaborative state (CRDT) | Yjs ([collab.md](collab.md)) |
| Typed RPC + bidi streaming | ConnectRPC ([connectrpc.md](connectrpc.md)) |
| Server → client only push | SSE ([sse.md](sse.md)) |
| Ad-hoc bidi JSON messages | **`partysocket` (this recipe)** |
| Third-party WebSocket bridge | **`partysocket`** (auto-reconnect for free) |
| Game-style 30+ Hz state sync | **`partysocket`** with binary frames |

Default to one of the first three. Reach for `partysocket` only
when none of them fit — and document why in the route file.

## Install

```bash
pnpm add partysocket
```

Single dep, no peer requirements. Works in browser + Node + Bun.

`partysocket` is the WebSocket client; the **server** is whatever you
already run (SvelteKit `+server.ts` with `ws` upgrade, PartyKit /
Cloudflare Durable Objects, raw Node `ws`, Go `gorilla/websocket`,
etc.). `partysocket` doesn't impose a server framework.

## Why not raw `WebSocket`?

Native `WebSocket` lacks:

- **Reconnection** — close fires, you implement retry.
- **Backoff + jitter** — thundering-herd on server restart.
- **Message queueing during reconnect** — sends fail silently.
- **Heartbeat** — idle TCP sockets get killed by middleboxes.
- **Lifecycle observability** — no built-in event for "now
  reconnecting".

`partysocket` ships all five with a small surface (~3 KB gzipped)
and exposes the same `addEventListener('message'|'open'|'close'|'error')`
API. Drop-in replacement once you've decided you need the polish.

## `useWebSocket()` shape

```ts
// @sveltesentio/realtime/ws (opt-in module per ADR-0038)
import PartySocket from 'partysocket';

export interface UseWebSocketOptions<TIn, TOut> {
  url: string | (() => string | Promise<string>);
  parse: (data: string | ArrayBuffer) => TIn;          // Zod-validated parser
  serialize?: (msg: TOut) => string | ArrayBuffer;     // default JSON.stringify
  onMessage?: (msg: TIn) => void;
  onOpen?: () => void;
  onClose?: (code: number, reason: string) => void;
  onError?: (e: Event) => void;
  protocols?: string | string[];
  startClosed?: boolean;
  minReconnectionDelay?: number;
  maxReconnectionDelay?: number;
  reconnectionDelayGrowFactor?: number;
  heartbeat?: { intervalMs: number; payload?: TOut };
}

export function useWebSocket<TIn, TOut = unknown>(
  options: UseWebSocketOptions<TIn, TOut>,
): {
  send(msg: TOut): void;
  close(code?: number, reason?: string): void;
  reopen(): void;
  readonly readyState: 0 | 1 | 2 | 3;
  readonly queueSize: number;
};
```

Two design points:

- **`parse` is mandatory.** Every message crosses an external
  boundary. No raw `JSON.parse → as T`.
- **`heartbeat` is opt-in.** Default off (ConnectRPC / Yjs
  already heartbeat); enable for raw-WS endpoints that don't.

## Component pattern

```svelte
<script lang="ts">
  import { useWebSocket } from '@sveltesentio/realtime/ws';
  import { z } from 'zod';

  const Inbound = z.discriminatedUnion('type', [
    z.object({ type: z.literal('chat'), id: z.string(), userId: z.string(), body: z.string() }),
    z.object({ type: z.literal('presence'), users: z.array(z.string()) }),
    z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
  ]);
  type Inbound = z.infer<typeof Inbound>;

  type Outbound =
    | { type: 'chat'; body: string }
    | { type: 'typing'; isTyping: boolean };

  let messages = $state<Array<{ id: string; userId: string; body: string }>>([]);
  let presence = $state<string[]>([]);
  let composer = $state('');

  const ws = useWebSocket<Inbound, Outbound>({
    url: '/api/chat/ws',
    parse: (data) => Inbound.parse(typeof data === 'string' ? JSON.parse(data) : data),
    onMessage: (msg) => {
      switch (msg.type) {
        case 'chat': messages.push({ id: msg.id, userId: msg.userId, body: msg.body }); break;
        case 'presence': presence = msg.users; break;
        case 'error': console.error('[ws] server error', msg); break;
      }
    },
    heartbeat: { intervalMs: 25_000, payload: { type: 'typing', isTyping: false } },
  });

  function send() {
    if (!composer.trim()) return;
    ws.send({ type: 'chat', body: composer });
    composer = '';
  }
</script>

<ul role="log" aria-live="polite" aria-relevant="additions">
  {#each messages as m (m.id)}
    <li>{m.userId}: {m.body}</li>
  {/each}
</ul>

<aside aria-label="Online users">
  {presence.length} online
</aside>

<form onsubmit={(e) => { e.preventDefault(); send(); }}>
  <input bind:value={composer}
         oninput={() => ws.send({ type: 'typing', isTyping: true })}
         disabled={ws.readyState !== 1} />
  <button type="submit" disabled={ws.readyState !== 1}>Send</button>
</form>

{#if ws.readyState === 0}
  <span role="status" class="sr-only">Connecting…</span>
{:else if ws.readyState === 3}
  <span role="status">Reconnecting…</span>
{/if}
```

Same `role="log" aria-live="polite" aria-relevant="additions"`
streaming-feed contract as [sse.md](sse.md). Streams are streams.

## Message-protocol design

Discriminated unions are mandatory for any non-trivial WS protocol.
Why:

- **Exhaustive switch.** Adding a new `type` breaks the type, not
  silently the runtime.
- **Schema-validate at the boundary.** Zod's `discriminatedUnion`
  emits efficient parsers (single field check before payload parse).
- **Forward compatibility.** Unknown `type` → loud error, not
  silently dropped.

Don't ship un-versioned protocols:

```ts
const Frame = z.object({
  v: z.literal(1),
  body: z.discriminatedUnion('type', [/* … */]),
});
```

When `v: 2` ships, the server can fall back; when `v: 0` arrives,
the server rejects with an upgrade-required code. `WebSocket` close
codes 4000-4999 are reserved for app use:

```text
4000 — protocol version unsupported
4001 — auth failed (re-login)
4002 — auth expired (refresh + reopen)
4003 — banned (don't reopen)
4090 — server overload (back off harder)
```

Document these in `+server.ts` so clients can switch on `code`:

```ts
ws.onClose = (code, reason) => {
  if (code === 4001 || code === 4002) goto('/login');
  if (code === 4003) toast.error('Banned: ' + reason);
  // else: partysocket auto-reconnects
};
```

## Auth

WebSocket has the same problem as `EventSource`: **no header control**.
The `Authorization` header can't be set.

Three auth options:

| Approach | When | Trade-off |
|---|---|---|
| HttpOnly session cookie | Same-origin (preferred) | XSRF protection via origin check on upgrade |
| Token in URL query | Cross-origin / token-bearer | **Tokens leak to server access logs** — short-lived only |
| Server-issued WS ticket | High security | Extra HTTP round-trip; ticket TTL ≤30 s |

Cookies are the default per ADR-0034. Cross-origin WS requires the
server to validate `Origin` header on upgrade — sveltesentio doesn't
ship a wildcard.

**Ticket pattern** (most defensible):

```ts
// 1. client requests ticket via authenticated HTTP
const { ticket } = await api.POST('/api/chat/ws-ticket').then((r) => r.data);

// 2. ticket goes in URL; server validates + invalidates after first use
const ws = useWebSocket({
  url: () => `/api/chat/ws?ticket=${encodeURIComponent(ticket)}`,
  // ...
});
```

Tickets are single-use, ≤30 s TTL, scoped to the WS endpoint. Logs
see the ticket value but it's already burned by the time the log
ships.

## Server-side (SvelteKit + `ws`)

SvelteKit's `+server.ts` doesn't natively expose the upgrade socket
in adapter-node, but Vite dev + many adapters (Cloudflare, Bun,
custom Node) do. Reference Node adapter pattern:

```ts
// src/server/ws.ts — bound by adapter-node hook
import { WebSocketServer } from 'ws';
import { uuidv7 } from '@sveltesentio/core/id';

export function attachWS(httpServer: import('http').Server) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', async (req, socket, head) => {
    if (!req.url?.startsWith('/api/chat/ws')) return;

    const session = await sessionFromCookieOrTicket(req);
    if (!session) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, { session, correlationId: uuidv7() });
    });
  });

  wss.on('connection', (ws, ctx) => {
    ws.on('message', (raw) => { /* … */ });
    ws.on('close', () => { /* unsubscribe */ });
    // app heartbeat — partysocket sends `{type:'typing',isTyping:false}` every 25 s
  });
}
```

PartyKit / Cloudflare Durable Objects users: that's the platform
sweet spot for `partysocket` + serverless — same author, designed
together.

## Observability

Per [observability.md](observability.md), wrap the WS lifecycle in a
span:

```ts
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('ws');
const sessionSpan = tracer.startSpan('ws.session', {
  attributes: {
    'ws.url': '/api/chat/ws',
    'correlation.id': correlationId,
  },
});

ws.addEventListener('close', () => sessionSpan.end());
```

Per-message spans are too noisy. Instead, count + histogram:

```ts
const meter = metrics.getMeter('ws');
const msgsRecv = meter.createCounter('ws.messages.received');
const msgLatency = meter.createHistogram('ws.message.parse.duration');
```

## Binary frames

JSON is the default. For game-style 30+ Hz state sync, use binary:

```ts
import { encode, decode } from '@msgpack/msgpack';        // or schema-driven binary

const ws = useWebSocket<StateUpdate, ClientInput>({
  url: '/api/game/ws',
  parse: (data) => StateUpdate.parse(decode(data as ArrayBuffer)),
  serialize: (msg) => encode(msg),
});
```

Bandwidth wins (3-5×) but loses DevTools inspectability. Prefer JSON
unless profiling shows the WS bandwidth is the bottleneck.

## Testing

`partysocket` accepts a constructor option to inject a mock socket
class. With Vitest:

```ts
import { Server } from 'mock-socket';

test('useWebSocket reconnects + flushes queued messages', async () => {
  const url = 'ws://localhost:9999/test';
  const server = new Server(url);
  const received: string[] = [];
  server.on('connection', (sock) => {
    sock.on('message', (m) => received.push(m as string));
  });

  const ws = useWebSocket({
    url, parse: (d) => JSON.parse(d as string),
    minReconnectionDelay: 50, maxReconnectionDelay: 100,
  });

  ws.send({ hello: 'world' });
  await new Promise((r) => setTimeout(r, 100));

  server.simulate('error');                   // forces reconnect
  ws.send({ after: 'reconnect' });
  await new Promise((r) => setTimeout(r, 200));

  expect(received).toEqual([
    JSON.stringify({ hello: 'world' }),
    JSON.stringify({ after: 'reconnect' }),
  ]);

  server.stop();
});
```

Playwright e2e against a real WS server is worth the budget for
auth + reconnect flows.

## Migration from raw `WebSocket`

```ts
// before
const ws = new WebSocket('/api/chat/ws');
ws.addEventListener('open', () => /* ... */);
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);             // unsafe
  /* … */
});
ws.addEventListener('close', () => /* manual reconnect logic */);
```

```ts
// after
const ws = useWebSocket({
  url: '/api/chat/ws',
  parse: (d) => Inbound.parse(typeof d === 'string' ? JSON.parse(d) : d),
  onMessage: handleInbound,
});
```

Mechanical:

1. Replace `new WebSocket(url)` with `useWebSocket({ url, parse, ... })`.
2. Move `JSON.parse + cast` into a Zod parser.
3. Delete custom reconnect / queue / backoff code.
4. Delete custom heartbeat (configure on the wrapper).
5. Migrate `onclose` reconnect-loop into the option callbacks.

A 100-line custom WS client typically collapses to ~15 lines.

## CSP

WS endpoints must be in `connect-src`:

```text
connect-src 'self' wss://api.yourapp.com;
```

For PartyKit / Cloudflare Durable Objects, allowlist the
party origin too (e.g. `wss://*.your-party.partykit.dev`).

## Anti-patterns

- **Reaching for `partysocket` when Yjs / ConnectRPC / SSE fit.**
  Adds a fourth realtime transport for no gain. Document why in
  the route file if you do.
- **`new WebSocket(url)` without reconnect / backoff / queue.**
  Production breaks at the first server restart. Use `partysocket`.
- **Raw `JSON.parse → as T` on `onmessage`.** External boundary
  without validation. Always Zod-parse.
- **No discriminated union for the inbound protocol.** Adding a new
  message type silently passes; runtime breaks. Force exhaustive
  switch.
- **Un-versioned protocol.** First server-side schema change breaks
  every connected client. `v: 1` from day one.
- **Tokens in WS URL** without ≤30 s TTL + single-use. Tokens leak
  to logs. Use ticket pattern or cookies.
- **`Origin` header not validated on upgrade.** Anyone's
  cross-origin page can open your WS. Same-origin or explicit
  allowlist.
- **No close-code switch.** Auth-expired → silent reconnect-loop.
  Switch on 4001/4002/4003.
- **Per-message OTel spans.** High-frequency channels → backend
  blowup. Counters + histograms instead.
- **Binary frames before profiling.** JSON is debuggable; binary is
  opaque. Switch only when bandwidth shows up in profiling.
- **`partysocket` as a framework default.** ADR-0038 D72 holds it
  opt-in. Yjs owns WS for collaborative state; this is the escape
  hatch.

## References

- ADR-0038 D72 — `partysocket` held opt-in.
- ADR-0034 — HttpOnly cookie sessions.
- ADR-0023 — UUIDv7 correlation IDs.
- [collab.md](collab.md) — Yjs over WebSocket (preferred for
  collaborative state).
- [connectrpc.md](connectrpc.md) — typed bidi RPC.
- [sse.md](sse.md) — server-only push.
- [schemas.md](schemas.md) — Zod at boundaries.
- [observability.md](observability.md) — WS span / metric pattern.
- partysocket: <https://github.com/partykit/partykit/tree/main/packages/partysocket>.
- WHATWG WebSocket: <https://websockets.spec.whatwg.org/>.
