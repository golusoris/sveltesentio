# Skill: add-realtime

Wire up a real-time data stream (SSE, WebSocket, or ConnectRPC) in a SvelteKit app.

## When to use

When the user needs live-updating data: dashboards, notifications, chat, collaborative editing.

---

## Option A — SSE (server-sent events, read-only stream)

Best for: dashboards, notifications, live metrics, one-way server→client push.

### Server: `src/routes/stream/+server.ts`

```typescript
import { produce } from 'sveltekit-sse';

export function GET() {
  return produce(async function start({ emit }) {
    // Emit events as they happen
    const interval = setInterval(() => {
      const cancelled = emit('update', JSON.stringify({ value: Math.random() }));
      if (cancelled) clearInterval(interval);
    }, 1000);

    return () => clearInterval(interval); // cleanup
  });
}
```

### Client: `+page.svelte`

```svelte
<script lang="ts">
  import { createSSESource } from '@sveltesentio/realtime';

  const { data: latest, status } = createSSESource<{ value: number }>('/stream', 'update');
</script>

{#if $status === 'connected'}
  <p>Latest: {$latest?.value}</p>
{:else}
  <p>Connecting…</p>
{/if}
```

---

## Option B — WebSocket (bidirectional)

Best for: chat, collaborative editing, bidirectional state sync.

### Client: `+page.svelte`

```svelte
<script lang="ts">
  import { createWebSocketStore } from '@sveltesentio/realtime';

  const ws = createWebSocketStore<{ type: string; payload: unknown }>('wss://api.example.com/ws');
  const { messages, send, status } = ws;
</script>

{#each $messages as msg}
  <div>{JSON.stringify(msg)}</div>
{/each}
<button onclick={() => send({ type: 'ping', payload: null })}>Ping</button>
```

---

## Option C — ConnectRPC (gRPC-web bidirectional)

Best for: app-subdo patterns, type-safe bidirectional streams with golusoris backend.

### Client: `src/lib/rpc/client.ts`

```typescript
import { createConnectTransport } from '@sveltesentio/realtime/connect';
import { createClient } from '@connectrpc/connect';
import { MyService } from './gen/my_service_pb.js';
import { PUBLIC_API_BASE_URL } from '$env/static/public';

export const transport = createConnectTransport({ baseUrl: PUBLIC_API_BASE_URL });
export const rpcClient = createClient(MyService, transport);
```

### Usage in component

```svelte
<script lang="ts">
  import { rpcClient } from '$lib/rpc/client.js';
  import { onDestroy } from 'svelte';

  let messages = $state<string[]>([]);
  const abort = new AbortController();

  async function stream() {
    for await (const msg of rpcClient.streamMessages({}, { signal: abort.signal })) {
      messages = [...messages, msg.text];
    }
  }

  $effect(() => { stream(); });
  onDestroy(() => abort.abort());
</script>
```

## Rules

- Always clean up connections: return cleanup from `$effect()` or use `onDestroy()`
- SSE: prefer for read-only data — simpler, auto-reconnects natively
- WebSocket: use for bidirectional; always handle `status === 'reconnecting'` in UI
- ConnectRPC: only with golusoris backend; always pass `AbortSignal` for cleanup
