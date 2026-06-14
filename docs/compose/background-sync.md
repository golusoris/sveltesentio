# Background Sync — Workbox BackgroundSyncPlugin + Idempotency-Key contract

Background Sync lets a PWA queue failed POSTs while offline and retry
them when connectivity returns. Extends [pwa.md](pwa.md) with the
BackgroundSyncPlugin wiring, the **mandatory Idempotency-Key
contract** (replays are the whole point), and the UX surface that
tells the user what's queued.

This is not a substitute for [server-state.md](server-state.md) optimistic
updates. Optimistic updates cover "user stays on the page while the
request is in flight"; Background Sync covers "user closed the tab /
lost connection and the request needs to survive". Both patterns
usually coexist.

## Related

- [pwa.md](pwa.md) — service worker foundation.
- [http-client.md](http-client.md) — `Idempotency-Key` header
  contract (this is the critical prerequisite).
- [server-state.md](server-state.md) — TanStack Query optimistic
  mutations complement this.
- [observability.md](observability.md) — SW → main-thread
  `postMessage` correlation.
- [ADR-0028](../adr/0028-vite-pwa-sveltekit.md) — PWA foundation.

## When to reach for it

```text
Form submit / action with tab open          → server-state.md (optimistic mutate)
Transient offline; user still on page       → server-state.md + retry
Complete offline; queue survives tab close  → Background Sync (this recipe)
Offline-first app (notes, todos, drafts)    → Yjs (collab.md) + IDB
Long-running batch job                      → server-side job queue, not SW
```

The Background Sync API has one capability that nothing else in the
stack matches: **the queue survives tab close and device reboot**. That
power is also its foot-gun — every queued request replays, so
non-idempotent handlers get called multiple times without the
client ever seeing the error.

## Install

Already in [pwa.md](pwa.md):

```bash
pnpm add -D @vite-pwa/sveltekit workbox-background-sync workbox-routing workbox-strategies
```

Switch to `injectManifest` strategy (see [pwa.md](pwa.md) — required
for custom handlers):

```ts
// vite.config.ts
import { SvelteKitPWA } from '@vite-pwa/sveltekit';

export default defineConfig({
  plugins: [
    sveltekit(),
    SvelteKitPWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'] },
      manifest: { /* … per pwa.md */ },
    }),
  ],
});
```

## Service worker — BackgroundSyncPlugin wiring

```ts
// src/sw.ts
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkOnly, NetworkFirst } from 'workbox-strategies';
import { BackgroundSyncPlugin, Queue } from 'workbox-background-sync';

declare const self: ServiceWorkerGlobalScope;

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

const MAX_RETENTION_MINUTES = 24 * 60;

const mutationPlugin = new BackgroundSyncPlugin('sveltesentio-mutations', {
  maxRetentionTime: MAX_RETENTION_MINUTES,
  onSync: async ({ queue }) => {
    let entry: { request: Request; timestamp: number } | undefined;
    while ((entry = await queue.shiftRequest())) {
      try {
        const response = await fetch(entry.request.clone());
        if (!response.ok && response.status < 500) {
          await notifyClients({
            kind: 'sync.drop',
            url: entry.request.url,
            status: response.status,
          });
          continue;
        }
        if (!response.ok) throw new Error(`status ${response.status}`);
        await notifyClients({ kind: 'sync.success', url: entry.request.url });
      } catch (err) {
        await queue.unshiftRequest(entry);
        await notifyClients({ kind: 'sync.retry', url: entry.request.url });
        throw err;
      }
    }
  },
});

registerRoute(
  ({ request, url }) =>
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) &&
    url.pathname.startsWith('/api/') &&
    url.pathname !== '/api/auth',
  new NetworkOnly({ plugins: [mutationPlugin] }),
  'POST',
);

registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new NetworkFirst({ cacheName: 'api-reads', networkTimeoutSeconds: 3 }),
  'GET',
);

async function notifyClients(message: object) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  for (const client of clients) client.postMessage(message);
}
```

Seven invariants:

1. **`maxRetentionTime`** — default is 3 days; sveltesentio uses 24 h.
   Old queued requests are usually stale (the data they referenced
   changed). Shorter retention = fewer zombie replays.
2. **Custom `onSync` for partial-failure handling.** The default replays
   the full queue atomically; if one request fails, all remaining
   requests re-queue. Our custom handler drops 4xx responses (client
   error → won't succeed on retry) but unshifts 5xx / network errors
   back onto the queue.
3. **Explicit route method args (`'POST'` etc.).** Workbox registers
   one route per method; `POST/PUT/PATCH/DELETE` each need their own
   `registerRoute`.
4. **Exclude `/api/auth`.** Auth mutations (login, logout, token
   refresh) are not safely replayable — a queued logout hitting a
   re-authed session is a security bug. Gate them out.
5. **`postMessage` back to clients on sync events.** Open tabs update
   their UI; see the client wiring below.
6. **4xx = drop, 5xx = retry.** Same contract as
   [http-client.md](http-client.md) — 4xx is deterministic, 5xx is
   transient.
7. **`NetworkOnly` strategy, not NetworkFirst.** Mutations never
   serve from cache; queueing is the offline behavior. Don't
   conflate caching and queueing.

## Client — Idempotency-Key on every mutation

Background Sync replays the **exact** stored request. If the original
succeeded at the server but the response failed to deliver (network
blip mid-response), the queue replays it and the server processes
it twice. Idempotency-Key is the only safe contract:

```ts
// src/lib/http/index.ts
import createClient from 'openapi-fetch';
import { v7 as uuid } from 'uuid';

export const api = createClient<paths>({
  baseUrl: '/api',
  fetch: (input, init) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return fetch(input, init);
    }
    const headers = new Headers(init?.headers);
    if (!headers.has('Idempotency-Key')) {
      headers.set('Idempotency-Key', uuid());
    }
    return fetch(input, { ...init, headers });
  },
});
```

Four hard rules:

1. **Every mutation gets a UUIDv7 Idempotency-Key.** The client mints
   it; the server uses it as a replay gate.
2. **Key is stable for the logical operation, not the retry.** If the
   user submits, the request gets key X. If Background Sync replays,
   it sends X again — server deduplicates.
3. **Server stores `(Idempotency-Key, response)` for ≥24 h.** Matches
   the `maxRetentionTime` above. Any replay within the window returns
   the cached response.
4. **Never omit the key on offline-capable routes.** A route registered
   with `BackgroundSyncPlugin` + no key is the classic double-payment
   bug.

The server contract is in [http-client.md](http-client.md); this recipe
just enforces the client-side half.

## Client — reacting to sync events

```svelte
<!-- src/lib/pwa/SyncBanner.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';

  type SyncEvent =
    | { kind: 'sync.retry'; url: string }
    | { kind: 'sync.success'; url: string }
    | { kind: 'sync.drop'; url: string; status: number };

  const state = $state<{ pending: number; lastError: string | null }>({
    pending: 0,
    lastError: null,
  });

  onMount(() => {
    if (!navigator.serviceWorker) return;
    const onMessage = (ev: MessageEvent<SyncEvent>) => {
      const msg = ev.data;
      if (msg.kind === 'sync.retry') {
        state.pending += 1;
      } else if (msg.kind === 'sync.success') {
        state.pending = Math.max(0, state.pending - 1);
      } else if (msg.kind === 'sync.drop') {
        state.pending = Math.max(0, state.pending - 1);
        state.lastError = `Server rejected ${msg.url} (${msg.status})`;
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  });
</script>

{#if state.pending > 0}
  <div role="status" aria-live="polite" class="fixed bottom-4 left-1/2 -translate-x-1/2 rounded bg-warning px-3 py-2 shadow">
    Sending {state.pending} queued change{state.pending > 1 ? 's' : ''}…
  </div>
{/if}

{#if state.lastError}
  <div role="alert" class="fixed bottom-4 left-1/2 -translate-x-1/2 rounded bg-danger px-3 py-2 shadow">
    {state.lastError}
  </div>
{/if}
```

The UX contract: users see what's queued. Silent queues erode trust;
loud queues build it. `role="status"` for pending (polite announce),
`role="alert"` for drops (assertive announce).

## Offline detection pattern

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  const online = $state(navigator.onLine);

  onMount(() => {
    const up = () => (online = true);
    const down = () => (online = false);
    addEventListener('online', up);
    addEventListener('offline', down);
    return () => {
      removeEventListener('online', up);
      removeEventListener('offline', down);
    };
  });
</script>

{#if !online}
  <div role="status" aria-live="polite" class="bg-muted px-3 py-2 text-sm">
    You're offline. Your changes will sync when you're back online.
  </div>
{/if}
```

`navigator.onLine` is a browser hint, not a ground truth — it reports
"connected to some network", not "can reach your server". Use it as
a UX signal; rely on fetch failures for correctness.

## Queue inspection — for debugging + support

Background Sync has no public inspection API. Emit introspection via
`postMessage` on demand:

```ts
// src/sw.ts (continued)
self.addEventListener('message', async (event) => {
  if (event.data?.kind === 'sync.introspect') {
    const queue = new Queue('sveltesentio-mutations');
    const requests = await queue.getAll();
    event.source?.postMessage({
      kind: 'sync.queue',
      items: requests.map((r) => ({
        url: r.request.url,
        method: r.request.method,
        timestamp: r.timestamp,
      })),
    });
  }
});
```

Client-side trigger:

```ts
navigator.serviceWorker.controller?.postMessage({ kind: 'sync.introspect' });
```

Use this sparingly (support-only); exposing it in the UI turns users
into queue debuggers.

## Server-side Idempotency-Key store

```ts
// src/lib/server/idempotency.ts
import type { RequestHandler } from '@sveltejs/kit';

type CachedResponse = {
  status: number;
  body: string;
  contentType: string;
  createdAt: Date;
};

export function withIdempotency(
  handler: RequestHandler,
): RequestHandler {
  return async (event) => {
    const key = event.request.headers.get('Idempotency-Key');
    const method = event.request.method;
    if (!key || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return handler(event);
    }

    const userId = event.locals.session?.user.id ?? 'anon';
    const cacheKey = `${userId}:${key}`;

    const cached = await event.locals.db.idempotency.get(cacheKey);
    if (cached) {
      return new Response(cached.body, {
        status: cached.status,
        headers: {
          'Content-Type': cached.contentType,
          'Idempotent-Replay': 'true',
        },
      });
    }

    const response = await handler(event);
    if (response.status < 500) {
      const body = await response.clone().text();
      await event.locals.db.idempotency.set(cacheKey, {
        status: response.status,
        body,
        contentType: response.headers.get('Content-Type') ?? 'application/json',
        createdAt: new Date(),
      }, { ttlSeconds: 86400 });
    }
    return response;
  };
}
```

Three server invariants:

1. **Scope by `userId`.** Two users can legitimately mint the same
   Idempotency-Key; separate namespaces.
2. **Cache responses with status < 500.** 5xx responses are "we don't
   know" — don't cache them; let the next retry hit the handler.
3. **TTL matches `maxRetentionTime`.** 24 h on both sides. Entries
   outside the window are either stale client-side or GC'd
   server-side.

## Testing

Fake `serviceWorker` + `indexedDB` in Vitest:

```ts
import { test } from 'vitest';
import 'fake-indexeddb/auto';
import { Queue } from 'workbox-background-sync';

test('queue replays requests on sync', async () => {
  const queue = new Queue('test-queue');
  await queue.pushRequest({
    request: new Request('/api/orders', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'test-key' },
      body: JSON.stringify({ item: 'x' }),
    }),
  });
  const stored = await queue.getAll();
  expect(stored).toHaveLength(1);
  expect(stored[0].request.headers.get('Idempotency-Key')).toBe('test-key');
});
```

E2E: Playwright with network throttling + offline toggle:

```ts
test('offline submit queues + replays', async ({ page, context }) => {
  await page.goto('/orders/new');
  await context.setOffline(true);
  await page.fill('input[name="item"]', 'Widget');
  await page.click('button[type="submit"]');
  await expect(page.getByRole('status')).toContainText(/queued/);
  await context.setOffline(false);
  await expect(page.getByRole('status')).toBeHidden({ timeout: 10_000 });
});
```

## Gotchas

- **Safari support is partial.** iOS ≤ 16 has no `SyncManager`.
  Workbox's `BackgroundSyncPlugin` falls back to retrying on
  `fetch` events in those browsers, which only fires when a tab is
  open — effectively "foreground retry". Document this in the UX
  layer.
- **Firefox has no `SyncManager`.** Same fallback.
- **The SW is throttled when the device sleeps.** Queued syncs may
  not fire for hours on a battery-saving iPhone. Acceptable — the
  UX must not promise instant delivery.
- **Browsers cap total sync quota.** Chrome allows ~1 MB total queued
  request bodies per origin. Large file uploads don't fit; use
  tus-js-client from [uploads.md](uploads.md) instead.
- **Requests with `Request.body` streams cannot be cloned after read.**
  Clone the request **before** the first fetch attempt:
  `queue.pushRequest({ request: request.clone() })`.
- **Auth token refresh during a queued replay.** If the stored request
  carries a now-expired bearer token, the replay gets 401. Use
  HttpOnly cookies instead (per
  [ADR-0034](../adr/0034-httponly-cookie-sessions.md)); cookies ride
  along automatically.

## Anti-patterns

- **Queueing mutations without `Idempotency-Key`.** Guarantees
  double-processing on replay. The whole pattern relies on the key.
- **Queueing `/api/auth` routes.** Replayed logins / logouts break
  session state. Always exclude.
- **Queueing file uploads.** 1 MB quota cap; use tus-js-client from
  [uploads.md](uploads.md) instead — resumable uploads are the
  purpose-built primitive.
- **Default `NetworkOnly` strategy without `BackgroundSyncPlugin`.**
  Mutations error-out silently offline. Either queue them or surface
  the error explicitly.
- **Single `Queue` for mixed domains.** Run separate queues per
  concern (mutations, telemetry, file-upload-finalise) so retention
  + backoff are tunable.
- **`maxRetentionTime: Infinity` or > 72 h.** Replays of week-old
  requests hit changed data. Shorter is safer.
- **Silent queue UI.** Users think their action failed, re-submit,
  now two requests queued. Show the pending count, show the drop.
- **Not handling `postMessage` in all tabs.** Multi-tab users see
  sync events in only one; broadcast via `clients.matchAll`
  (already done above).
- **Testing against dev-server + HMR.** The SW doesn't activate in
  dev. Test against `pnpm preview` (built bundle), matching
  [playwright-visual.md](playwright-visual.md).
- **Assuming replay is immediate.** SW wakeup is OS-scheduled.
  Critical paths (checkout) do not rely on Background Sync; use
  real-time retry on the main thread.
- **`BackgroundSyncPlugin` on GET.** GETs are safe to retry, no
  queueing needed — just use `NetworkFirst`.
- **No server-side key deduplication.** The client promise is
  meaningless if the server doesn't honor it. Both halves required.

## References

- [pwa.md](pwa.md) — service worker foundation.
- [http-client.md](http-client.md) — Idempotency-Key contract.
- [server-state.md](server-state.md) — TanStack Query optimistic
  mutations.
- [observability.md](observability.md) — SW → main-thread bridge.
- [ADR-0028](../adr/0028-vite-pwa-sveltekit.md) — PWA foundation.
- [ADR-0034](../adr/0034-httponly-cookie-sessions.md) — HttpOnly
  session cookies (replay-safe).
- Workbox Background Sync: <https://developer.chrome.com/docs/workbox/modules/workbox-background-sync>.
- Background Sync Web API: <https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API>.
- RFC idempotency (draft): <https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/>.
