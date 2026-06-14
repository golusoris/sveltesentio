# Web Push — PushManager + service-worker handler + server VAPID

Web Push delivers notifications when the tab is closed. It's a sibling
of [pwa.md](pwa.md) — it rides on the service worker from that recipe
and adds the push-subscription + `PushEvent` handler pieces. This
recipe documents the end-to-end contract: **client subscription →
server-side VAPID push → SW `push` handler → `notificationclick`
routing**.

Web Push is not the same as a toast or in-app notification
([toast.md](toast.md)). Reach for Web Push only when the message is
valuable to receive **with the tab closed** (a DM, a transactional
confirmation, an urgent alert). Otherwise stay in-app.

## Related

- [pwa.md](pwa.md) — service-worker registration, manifest, update
  prompt. Web Push requires the SW from this recipe.
- [toast.md](toast.md) — in-app notifications; reach for toast first.
- [auth-oidc.md](auth-oidc.md) — session identity for associating
  subscriptions with users.
- [observability.md](observability.md) — UUIDv7 correlation on
  delivery + click events.
- [ai-audit-hook.md](ai-audit-hook.md) — template for the "don't default
  to a sink" pattern (push endpoint is PII; same stance applies).
- [ADR-0028](../adr/0028-vite-pwa-sveltekit.md) — PWA foundation.
- [ADR-0034](../adr/0034-httponly-cookie-sessions.md) — session cookie
  that authenticates the subscribe endpoint.

## When to reach for it

```text
Urgent / time-sensitive with tab closed   → Web Push
Tab-open notification                     → toast.md
Long-lived feed / inbox                   → in-app list (no push needed)
Background-sync completion                → check BackgroundSyncPlugin in pwa.md
Marketing broadcast                       → don't — users hate it
```

Web Push has a **permission cost**. Ask once, at the moment the user
would value it (after they subscribe to a thread / complete an order).
Never on first page load — Chrome suppresses abusive prompts and the
permission goes `denied` forever.

## Install (client)

No dep needed — `PushManager` is a native Web API. The SW handler ships
in the Workbox-generated SW from [pwa.md](pwa.md); we extend it with a
custom SW snippet.

```ts
// src/sw-custom.ts — imported by the SW per pwa.md customFile option
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? { title: 'Update', body: '' };
  event.waitUntil(showNotification(data));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(routeClick(event.notification.data));
});
```

Point `SvelteKitPWA({ strategies: 'injectManifest', srcDir: 'src', filename: 'sw.ts' })`
and import `sw-custom.ts` from your `sw.ts`. `generateSW` (the default
in [pwa.md](pwa.md)) doesn't accept custom push handlers — pick
`injectManifest` when push is needed.

## Install (server)

```bash
pnpm add web-push
```

Peer: `web-push@^3.6`. It handles VAPID signing + the ECE payload
encryption so you don't implement RFC 8291 by hand.

Generate VAPID keys **once**, store them in secrets:

```bash
pnpm exec web-push generate-vapid-keys
```

Save `publicKey` + `privateKey` to the server secret store (never ship
`privateKey` to the client). `publicKey` is shared with the client
via a `/api/push/vapid-public` endpoint.

## Subscribe flow — end-to-end

```svelte
<!-- src/lib/push/PushToggle.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';

  const state = $state<{
    supported: boolean;
    permission: NotificationPermission;
    subscribed: boolean;
    working: boolean;
  }>({ supported: false, permission: 'default', subscribed: false, working: false });

  onMount(async () => {
    if (!browser) return;
    const supported =
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window;
    if (!supported) return;

    state.supported = true;
    state.permission = Notification.permission;

    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    state.subscribed = !!sub;
  });

  async function subscribe() {
    state.working = true;
    try {
      const perm = await Notification.requestPermission();
      state.permission = perm;
      if (perm !== 'granted') return;

      const { publicKey } = await fetch('/api/push/vapid-public').then((r) =>
        r.json(),
      );
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!res.ok) throw new Error('subscribe failed');
      state.subscribed = true;
    } finally {
      state.working = false;
    }
  }

  async function unsubscribe() {
    state.working = true;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return;
      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      await sub.unsubscribe();
      state.subscribed = false;
    } finally {
      state.working = false;
    }
  }

  function urlBase64ToUint8Array(b64: string): Uint8Array {
    const padding = '='.repeat((4 - (b64.length % 4)) % 4);
    const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }
</script>

{#if !state.supported}
  <p role="note">Push notifications aren't supported on this browser.</p>
{:else if state.permission === 'denied'}
  <p role="note">
    Notifications are blocked. Enable them in your browser site settings.
  </p>
{:else if state.subscribed}
  <button onclick={unsubscribe} disabled={state.working}>
    Turn off notifications
  </button>
{:else}
  <button onclick={subscribe} disabled={state.working}>
    Enable notifications
  </button>
{/if}
```

Four invariants in this flow:

1. **Feature-detect first.** Safari < 16.4, Firefox on iOS, and no-SW
   environments are common; render an informative fallback.
2. **`userVisibleOnly: true`** — required by Chromium; silent push is
   forbidden for third-party origins.
3. **`credentials: 'include'`** on subscribe/unsubscribe so the
   HttpOnly session cookie authenticates the request per
   [ADR-0034](../adr/0034-httponly-cookie-sessions.md).
4. **Local + server unsubscribe are both required.** `sub.unsubscribe()`
   tears down the browser-side half; the server has to drop the row
   too or you push to a dead endpoint forever.

## Server: subscribe endpoint

```ts
// src/routes/api/push/subscribe/+server.ts
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';

const SubscriptionSchema = z.object({
  endpoint: z.string().url(),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export const POST: RequestHandler = async ({ request, locals }) => {
  const user = locals.session?.user;
  if (!user) return json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json();
  const parsed = SubscriptionSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'invalid' }, { status: 400 });
  }

  await locals.db.push.upsert(user.id, {
    endpoint: parsed.data.endpoint,
    p256dh: parsed.data.keys.p256dh,
    auth: parsed.data.keys.auth,
    userAgent: request.headers.get('user-agent') ?? '',
    createdAt: new Date(),
  });

  return json({ ok: true });
};
```

Unique key on `(userId, endpoint)` — one device can have only one
active subscription per user. Store the `userAgent` for the user-facing
"active devices" list (see the revoke pattern below).

## Server: send push

```ts
// src/lib/server/push.ts (server-only)
import webpush from 'web-push';
import { env } from '$env/dynamic/private';

webpush.setVapidDetails(
  'mailto:ops@example.com',
  env.VAPID_PUBLIC_KEY,
  env.VAPID_PRIVATE_KEY,
);

export type PushPayload = {
  title: string;
  body: string;
  url: string;
  tag?: string;
  correlationId: string;
};

export async function sendPush(
  sub: { endpoint: string; p256dh: string; auth: string },
  payload: PushPayload,
): Promise<'ok' | 'gone' | 'error'> {
  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      JSON.stringify(payload),
      { TTL: 3600, urgency: 'high' },
    );
    return 'ok';
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) return 'gone';
    return 'error';
  }
}
```

Handle `410 Gone` / `404 Not Found` by deleting the subscription row —
the browser has already revoked it (user uninstalled the PWA, cleared
site data, revoked permission). Never retry `410`.

## SW handler — `push` + `notificationclick`

```ts
// src/sw-custom.ts (continued)
import { z } from 'zod';

const PayloadSchema = z.object({
  title: z.string(),
  body: z.string(),
  url: z.string(),
  tag: z.string().optional(),
  correlationId: z.string().uuid(),
});

async function showNotification(raw: unknown) {
  const parsed = PayloadSchema.safeParse(raw);
  if (!parsed.success) return;
  const { title, body, url, tag, correlationId } = parsed.data;

  await self.registration.showNotification(title, {
    body,
    tag,
    icon: '/icons/pwa-192.png',
    badge: '/icons/badge-72.png',
    data: { url, correlationId },
    requireInteraction: false,
    silent: false,
  });
}

async function routeClick(data: { url?: string; correlationId?: string } | undefined) {
  const target = data?.url ?? '/';
  const all = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });

  for (const client of all) {
    const cu = new URL(client.url);
    const tu = new URL(target, cu.origin);
    if (cu.pathname === tu.pathname && 'focus' in client) {
      return client.focus();
    }
  }
  if (self.clients.openWindow) await self.clients.openWindow(target);
}
```

Two a11y / UX invariants:

1. **Zod-parse the payload.** The push endpoint is a webhook in
   disguise; never trust the body. Same boundary rule as every other
   `+server.ts` per [schemas.md](schemas.md).
2. **Focus existing tab before opening a new one.** Users hate
   duplicate tabs. Walk `clients.matchAll` and `focus()` a matching
   path before `openWindow`.

## CSP + manifest

```text
Content-Security-Policy:
  default-src 'self';
  worker-src 'self';
  connect-src 'self' https://*.push.apple.com https://fcm.googleapis.com https://*.notify.windows.com;
  manifest-src 'self';
```

`connect-src` needs the push-service origins the browser POSTs the
subscription to (Apple / FCM / Windows). These are browser-owned
endpoints, not your origin — the CSP has to allow them or the SW
subscribe fails silently.

## User-facing "active devices" + revoke

Every subscription is tied to a user + userAgent. Show them in settings:

```text
Notifications enabled on:
  • Chrome on macOS          Enabled 2026-04-10        [Revoke]
  • Safari on iOS 17         Enabled 2026-04-15        [Revoke]
```

[Revoke] hits `/api/push/unsubscribe` with the endpoint; the server
deletes the row. The device keeps the `pushManager.subscription`
locally until the user either re-subscribes or clears site data — but
the server drops sends, which is what matters for privacy.

On logout, delete **all** push subscriptions for the user. Same pattern
as [collab-persistence.md](collab-persistence.md) IDB purge + uploads
tus-fingerprint purge — session-bounded state goes away on logout,
especially on shared devices.

## Rate limiting + quiet hours

Per-user push rate limit (e.g. 10 / hour burst, 100 / day) to protect
against buggy sender code. The push-service providers also rate-limit:
Apple drops >3 pushes / s per endpoint without `apns-collapse-id`
header support (not exposed by web-push; tag collision is the closest
substitute).

Quiet hours (22:00–08:00 local) is a user preference. Store it in the
user profile; the sender reads it before calling `sendPush`. Don't try
to implement it in the SW — the SW has no clock reliability outside
an active push event.

## Observability

Thread UUIDv7 per push per [observability.md](observability.md):

- **Server emit**: span `push.send` with attributes
  `{ userId, endpoint: hash(endpoint), correlationId, result: 'ok' | 'gone' | 'error' }`.
- **SW receive** (best-effort): `postMessage` from SW to an open client
  with `{ correlationId, event: 'received' }` so analytics can join.
- **Click**: `notificationclick` posts to an open client if any; on
  `openWindow` the landing page reads `correlationId` from a query
  param.

Do **not** log the raw endpoint (user-specific; Apple treats it as
PII). Hash with a per-tenant salt.

## Testing

Unit: VAPID signing + 410 handling via `nock`:

```ts
import { test, vi } from 'vitest';
import nock from 'nock';
import { sendPush } from '$lib/server/push';

test('sendPush returns "gone" on 410', async () => {
  nock('https://fcm.googleapis.com').post(/.*/).reply(410, 'Gone');
  const result = await sendPush(
    { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: '…', auth: '…' },
    { title: 'T', body: 'B', url: '/', correlationId: crypto.randomUUID() },
  );
  expect(result).toBe('gone');
});
```

Integration: Playwright with Chromium's `grantPermissions`:

```ts
test('subscribe round-trip', async ({ context, page }) => {
  await context.grantPermissions(['notifications']);
  await page.goto('/settings/notifications');
  await page.click('button:has-text("Enable notifications")');
  await expect(page.getByText('Turn off notifications')).toBeVisible();
});
```

Playwright has no `PushManager` mock — for true push-receipt testing
use `puppeteer-push-service` or a local push-relay. Most teams skip
this test and rely on production smoke.

## Anti-patterns

- **Prompting on first load.** Chrome blocks abusive prompts and
  marks the origin; the user never sees the prompt again. Always
  contextual.
- **`userVisibleOnly: false`.** Browsers reject the subscription.
  Silent push requires an origin allowlist you won't get.
- **Skipping Zod on the SW payload.** Push payload is attacker-influenced
  (a compromised push service could replay); always parse.
- **Hard-coded VAPID keys.** Check them into env / secret store; key
  rotation means issuing a new `applicationServerKey` and
  re-subscribing every client.
- **Ignoring `410 Gone`.** Dead endpoints pile up forever; metrics go
  sideways; eventually the push service starts throttling your origin.
- **Duplicate tabs on `notificationclick`.** `clients.matchAll` +
  `focus()` existing tab first; `openWindow` only if nothing matches.
- **Raw endpoint in observability.** User-specific; treat as PII. Hash
  with per-tenant salt or store only the service provider
  (`fcm | apple | mozilla`).
- **Push for marketing.** Users revoke and never come back. Use email /
  in-app for broadcasts; Web Push is for urgent-to-this-user.
- **Relying on SW scheduling.** SW wakes only on a `push` event; it
  cannot poll or maintain a timer. Quiet hours logic lives on the
  server, not the SW.
- **Not purging subscriptions on logout.** Shared-device leak — next
  user still receives the prior user's DMs. Same contract as IDB
  purge in [collab-persistence.md](collab-persistence.md).
- **CSP without push-service origins in `connect-src`.** Subscribe
  fails silently with no console output (in some browsers).
- **`generateSW` strategy with custom handlers.** The default
  [pwa.md](pwa.md) strategy doesn't accept custom `push` handlers.
  Switch to `injectManifest` when push is needed.
- **Bypassing [toast.md](toast.md) for in-app notifications.** Web Push
  is for tab-closed; toast covers tab-open. Don't conflate them.

## References

- [ADR-0028](../adr/0028-vite-pwa-sveltekit.md) — PWA foundation.
- [ADR-0034](../adr/0034-httponly-cookie-sessions.md) — session cookie.
- [pwa.md](pwa.md) — service worker (prerequisite).
- [toast.md](toast.md) — in-app notifications.
- [observability.md](observability.md) — UUIDv7 correlation.
- [schemas.md](schemas.md) — Zod boundary validation.
- `web-push` (Node): <https://github.com/web-push-libs/web-push>.
- MDN Push API: <https://developer.mozilla.org/en-US/docs/Web/API/Push_API>.
- VAPID spec (RFC 8292): <https://datatracker.ietf.org/doc/html/rfc8292>.
- Message encryption (RFC 8291): <https://datatracker.ietf.org/doc/html/rfc8291>.
