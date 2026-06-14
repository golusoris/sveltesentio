# PWA — `@vite-pwa/sveltekit` service worker + manifest + update prompt

`@sveltesentio/shell` ships PWA wiring via
`@vite-pwa/sveltekit@^1.1.0` per
[ADR-0028](../adr/0028-vite-pwa-sveltekit.md). The adapter wraps
`vite-plugin-pwa` (which wraps Workbox) with SvelteKit-specific SSR
hooks for service worker registration, manifest generation, and
update lifecycle.

Serwist is the alternative; `@serwist/sveltekit` does not exist on
npm (2026-04). Re-audit deferred to v0.3.

This recipe documents `vite.config.ts` plugin config, manifest
authoring, four caching strategies + when to use which, the
`updateSW()` consent prompt, offline-fallback page, and the CSP
implications.

Related: [safe-area.md](safe-area.md) (PWA viewport + insets),
[theming-flash-free.md](theming-flash-free.md) (theme cookie applies
offline too), [media-player.md](media-player.md) (don't cache video
payloads), [collab-persistence.md](collab-persistence.md) (IndexedDB
state survives offline), [observability.md](observability.md) (SW
events as structured logs).

## When you need a PWA

| Need | Build a PWA | Skip |
|---|---|---|
| Offline-capable workflow | ✅ | — |
| Install-to-homescreen on mobile | ✅ | — |
| Background sync / push | ✅ | — |
| Static-marketing site | ❌ overhead | ✅ |
| SEO-only blog | ❌ overhead | ✅ |
| App-store-distributed only | ⚠️ TWA opt-in | App-store native |

PWA pays off when offline + install matter. Static SSG sites don't
need a service worker; the cache headers already do the work.

## Install

```bash
pnpm add -D @vite-pwa/sveltekit vite-plugin-pwa workbox-window
```

`workbox-window` is the small client-side update-prompt helper
(~3 KB). `vite-plugin-pwa` brings Workbox build-time codegen.

## `vite.config.ts` setup

```ts
// vite.config.ts
import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';

export default {
  plugins: [
    sveltekit(),
    SvelteKitPWA({
      strategies: 'generateSW',                  // Workbox autogen; 'injectManifest' for custom SW
      registerType: 'prompt',                    // see "Update prompt" below
      includeAssets: ['favicon.svg', 'fonts/*.woff2'],
      manifest: {
        name: 'Sveltesentio Demo',
        short_name: 'Sveltesentio',
        theme_color: '#0f172a',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'any',
        scope: '/',
        start_url: '/',
        icons: [
          { src: '/icons/192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['client/**/*.{js,css,svg,woff2}'],
        navigateFallback: '/offline',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          // documented below
        ],
      },
      kit: {
        includeVersionFile: true,                // exposes APP_VERSION for update detection
      },
      devOptions: {
        enabled: false,                          // SW in dev is a debugging hazard
      },
    }),
  ],
};
```

Six invariants:

1. **`registerType: 'prompt'`** not `'autoUpdate'`. Users see the
   update banner and click. Auto-update mid-session loses unsaved
   form state.
2. **`includeAssets`** for static files outside `static/`. Fonts +
   favicon need explicit listing (Workbox glob doesn't reach them
   automatically).
3. **`navigateFallbackDenylist: [/^\/api\//]`** so API routes
   don't fall back to `/offline.html`. APIs return real errors.
4. **Maskable icon present.** Android adaptive icons crop;
   non-maskable icons get awkward circles.
5. **`devOptions.enabled: false`.** Service workers in dev cache
   stale code + confuse HMR. Dev runs without SW.
6. **`includeVersionFile: true`** writes `version.json` so the
   client can poll for new builds.

## Caching strategies — pick deliberately

Workbox ships five strategies. Match each to its use case:

| Strategy | When to use | Trade-off |
|---|---|---|
| `CacheFirst` | Immutable assets (hashed JS/CSS, fonts) | Stale forever without versioning |
| `StaleWhileRevalidate` | App shell HTML, mostly-static API responses | Old data shown briefly then refresh |
| `NetworkFirst` | Auth-gated API responses, user-specific data | Fails with 504-gateway-timeout offline |
| `NetworkOnly` | Mutations (POST/PUT/DELETE), `+server.ts` writes | No offline behaviour; correct for writes |
| `CacheOnly` | Pre-cached offline page, app icon | Hard fail if not pre-cached |

```ts
runtimeCaching: [
  // hashed build artifacts — cache forever, version in URL invalidates
  {
    urlPattern: /\/_app\/immutable\/.*\.(?:js|css|woff2|svg|png|jpg|webp)$/,
    handler: 'CacheFirst',
    options: {
      cacheName: 'app-immutable',
      expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 365 },
    },
  },
  // app shell — refresh in background, serve cache for instant load
  {
    urlPattern: ({ request }) => request.destination === 'document',
    handler: 'StaleWhileRevalidate',
    options: { cacheName: 'app-shell', expiration: { maxAgeSeconds: 60 * 60 * 24 * 7 } },
  },
  // user data — try network, fall back to last cached only when offline
  {
    urlPattern: /\/api\/feed/,
    handler: 'NetworkFirst',
    options: {
      cacheName: 'api-feed',
      networkTimeoutSeconds: 4,
      expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 },
    },
  },
  // mutations — never cache; let the server reject offline
  {
    urlPattern: /\/api\/.*/,
    method: 'POST',
    handler: 'NetworkOnly',
  },
  // images from your CDN — cache aggressively, cap entries
  {
    urlPattern: /^https:\/\/cdn\.yourapp\.com\/.*\.(?:png|jpg|webp|avif)$/,
    handler: 'CacheFirst',
    options: {
      cacheName: 'cdn-images',
      expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 },
      cacheableResponse: { statuses: [0, 200] },
    },
  },
],
```

Three rules:

- **POST / PUT / DELETE → `NetworkOnly`.** Never replay mutations;
  the server is the truth.
- **Auth-gated GET → `NetworkFirst` with short timeout.** A logged-in
  user offline sees their last data, not a stranger's.
- **Don't cache `text/event-stream`, video, or large media.** SW
  cache is bounded; streams break browser SW assumptions. Per
  [media-player.md](media-player.md), only meta is cached.

## Update prompt

```svelte
<!-- src/lib/pwa/UpdatePrompt.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { useRegisterSW } from 'virtual:pwa-register/svelte';

  const {
    needRefresh,
    offlineReady,
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) { console.error('[pwa] sw register failed', error); },
  });
</script>

{#if $needRefresh}
  <div role="dialog" aria-labelledby="pwa-update-title" aria-modal="true">
    <h2 id="pwa-update-title">Update available</h2>
    <p>A new version is ready. Reload to apply.</p>
    <button onclick={() => updateServiceWorker(true)}>Reload</button>
    <button onclick={() => needRefresh.set(false)}>Later</button>
  </div>
{:else if $offlineReady}
  <span role="status">Ready to work offline</span>
{/if}
```

`updateServiceWorker(true)` reloads the page after activating the
new SW. `false` activates without reloading (risk: code/asset
mismatch; only safe for fully self-contained SW updates).

Show the banner **once per detected update**. Polling cadence:
default `vite-plugin-pwa` checks every page load; for long-running
sessions add a periodic check:

```ts
useRegisterSW({
  onRegisteredSW(swUrl, sw) {
    if (sw) {
      setInterval(async () => {
        await sw.update();                     // check for new SW
      }, 60 * 60 * 1000);                      // hourly
    }
  },
});
```

## Offline fallback page

```svelte
<!-- src/routes/offline/+page.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  let online = $state(true);
  $effect(() => {
    online = navigator.onLine;
    const onOnline = () => online = true;
    const onOffline = () => online = false;
    addEventListener('online', onOnline);
    addEventListener('offline', onOffline);
    return () => {
      removeEventListener('online', onOnline);
      removeEventListener('offline', onOffline);
    };
  });
</script>

<main role="main">
  <h1>You're offline</h1>
  <p>Recent pages are still readable. Try again when you're back online.</p>
  {#if online}
    <button onclick={() => location.reload()}>Reload</button>
  {/if}
</main>
```

Pre-cached at install time (Workbox pre-cache manifest includes the
`/offline` route via the `globPatterns` build glob). When a
navigation request fails, Workbox serves this page.

## Theming + safe-area interop

PWA standalone mode hides browser chrome — your shell paints to the
edges. Per [safe-area.md](safe-area.md):

```html
<!-- app.html -->
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0f172a" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
```

`viewport-fit=cover` enables `env(safe-area-inset-*)`. The two
`theme-color` meta tags drive the iOS status bar tint per scheme.

Per [theming-flash-free.md](theming-flash-free.md), the theme cookie
is read by the SW pre-cache so the offline shell renders in the
correct mode without flash.

## CSP implications

Service workers register at the origin scope — your CSP must allow:

```text
default-src 'self';
worker-src 'self' blob:;
script-src 'self' 'wasm-unsafe-eval';        # workbox uses wasm-unsafe-eval in dev only
manifest-src 'self';
```

For `injectManifest` strategy with a custom SW that imports from a
CDN, allowlist that origin in `script-src` — but prefer self-hosting
to avoid drift.

## Push notifications

Out of scope for the default `pwa.md` recipe. Push requires:

- VAPID keys (server-generated).
- `Notification.requestPermission()` on a user gesture (never on
  load).
- Server endpoint to accept subscriptions + send via Web Push
  Protocol.

If you need push, follow `docs/compose/web-push.md` (pending). Don't
prompt for notification permission proactively — Lighthouse / SEO
penalty + UX dark pattern.

## Background sync

`vite-plugin-pwa` exposes Workbox's `BackgroundSyncPlugin` for
queueing failed POSTs:

```ts
import { BackgroundSyncPlugin } from 'workbox-background-sync';
import { Queue } from 'workbox-background-sync';

const queue = new BackgroundSyncPlugin('mutations-queue', {
  maxRetentionTime: 24 * 60,                   // minutes
});

runtimeCaching: [
  {
    urlPattern: /\/api\/notes/,
    method: 'POST',
    handler: 'NetworkOnly',
    options: { plugins: [queue] },
  },
],
```

Use sparingly — replayed mutations cause double-creates if the
server doesn't dedupe. Pair with `Idempotency-Key` per
[http-client.md](http-client.md).

## Observability

Service worker is a separate execution context — your main-thread
OTel SDK doesn't see it. Bridge via `postMessage`:

```ts
// in SW
self.addEventListener('fetch', (e) => {
  const t0 = performance.now();
  e.respondWith((async () => {
    const res = await caches.match(e.request) ?? await fetch(e.request);
    self.clients.matchAll().then((clients) => {
      clients.forEach((c) => c.postMessage({
        type: 'sw.fetch',
        url: e.request.url,
        durationMs: performance.now() - t0,
        cached: !!await caches.match(e.request),
      }));
    });
    return res;
  })());
});

// in main thread
navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type === 'sw.fetch') track('sw.fetch', e.data);
});
```

Counters + histograms only — per-request spans blow up cardinality
per [observability.md](observability.md).

## Testing

Unit tests for SW logic are difficult — `service-worker` global isn't
available in jsdom. Two practical paths:

1. **Workbox's built-in test harness.** `workbox-build` exposes
   `getManifest()` + cache-strategy unit tests.
2. **Playwright with SW enabled.** Real Chromium installs the SW;
   you can drive offline mode:

```ts
test('offline fallback works', async ({ page, context }) => {
  await page.goto('/');                        // SW installs
  await context.setOffline(true);
  await page.goto('/some/uncached/route');
  await expect(page.getByRole('heading', { level: 1 })).toContainText("You're offline");
  await context.setOffline(false);
});
```

CI: run PWA Playwright suite nightly, not on every PR (SW state
across runs is flaky).

## Static hosting gotcha

`adapter-static` works with PWA, but: if you set `paths.relative =
true` (relative asset paths for sub-path hosting), Workbox's
absolute-URL pre-cache manifest breaks. Either:

- `paths.relative = false` + serve from absolute origin root, **or**
- Custom `injectManifest` SW that resolves URLs at install time.

Document the choice in the deploy README.

## Anti-patterns

- **`registerType: 'autoUpdate'`** on apps with form state. Mid-
  session reload loses unsaved data. Always `prompt` + user gesture.
- **`devOptions.enabled: true`.** SW in dev caches stale builds +
  confuses HMR. Production-only.
- **Caching `POST` / `PUT` / `DELETE`.** Mutation replay = double
  creates. `NetworkOnly` for writes; pair with `Idempotency-Key`
  if you need queue.
- **No `navigateFallbackDenylist` for `/api/`.** API requests fall
  back to HTML; clients can't parse. Always exclude `/api/`.
- **Caching `text/event-stream` / video / large media.** Breaks
  streaming + blows cache budget. Never.
- **`NetworkOnly` for auth-gated GET that might run offline.** User
  sees raw error. `NetworkFirst` with short timeout + cached
  fallback.
- **No maskable icon.** Android adaptive launcher crops awkwardly.
  Always include 512x512 `purpose: 'maskable'`.
- **Notification permission prompt on load.** UX dark pattern +
  Lighthouse penalty. User gesture only.
- **Background sync without `Idempotency-Key`.** Replayed POSTs
  cause double-creates server-side.
- **Periodic `sw.update()` more than hourly.** Network thrash,
  battery drain. Hourly is plenty.
- **Push subscriptions stored without TTL / cleanup.** Stale
  subscriptions waste push quota + leak data.
- **Custom SW imported from CDN without `script-src` allowlist.**
  CSP blocks at first install; SW dies silently. Self-host.
- **Skipping the offline fallback route.** Default browser error
  page is hostile. Pre-cache `/offline`.
- **Caching authenticated CDN images cross-user.** Browser cache
  keys by URL only — bearer-token-free CDN URLs leak across
  sessions. Use signed URLs with per-user tokens.
- **`includeVersionFile: false`.** Client can't detect when a new
  build is live; users stay on stale code indefinitely.

## References

- ADR-0028 — `@vite-pwa/sveltekit` PWA layer.
- [safe-area.md](safe-area.md) — `viewport-fit=cover` + inset
  utilities for standalone mode.
- [theming-flash-free.md](theming-flash-free.md) — theme cookie
  applies offline.
- [media-player.md](media-player.md) — never cache video payloads.
- [collab-persistence.md](collab-persistence.md) — IndexedDB state
  survives offline alongside SW cache.
- [observability.md](observability.md) — SW → main-thread bridge.
- [http-client.md](http-client.md) — `Idempotency-Key` for
  background-sync replays.
- vite-plugin-pwa: <https://vite-pwa-org.netlify.app/>.
- Workbox: <https://developer.chrome.com/docs/workbox>.
- W3C Manifest: <https://www.w3.org/TR/appmanifest/>.
- `docs/compliance/csp-pwa.md` (pending) — full CSP audit for SW.
