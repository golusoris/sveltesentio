# Notifications center — in-app inbox + read state + batching + digest

> Persistent in-app notification inbox with unread badge, realtime
> updates, batching, and digest rules. Composes
> [sse.md](sse.md) for push-over-HTTP, [web-push.md](web-push.md)
> for native OS push, [toast.md](toast.md) for transient messages,
> [queue-workers.md](queue-workers.md) for fan-out,
> [structured-emails.md](structured-emails.md) for the email
> channel, and [schemas.md](schemas.md) for a bounded event shape.
> Notifications are **events, not messages** — the center renders
> events; channels (in-app, email, push) decide how to deliver them.

A notification center is **the user's queue of pending attention
debt**. Get the batching wrong and you nag; get the read-state
wrong and users miss alerts; get the channel routing wrong and you
spam email while the user is live in-app. The patterns below
prioritize **user-controlled delivery, idempotent fan-out, and
clear read/dismiss semantics** over shipping features fast.

## Related

- [sse.md](sse.md) — realtime unread count + new-item push
- [web-push.md](web-push.md) — OS notification channel
- [toast.md](toast.md) — transient alerts (different surface)
- [queue-workers.md](queue-workers.md) — fan-out worker per channel
- [structured-emails.md](structured-emails.md) — email digest channel
- [consent-management.md](consent-management.md) — marketing
  notification consent (C3)
- [onboarding.md](onboarding.md) — first-run delivery preferences
  walkthrough
- [service-limits.md](service-limits.md) — quota on sends per tenant
- [audit-log.md](audit-log.md) — marketing sends audited for CAN-SPAM
- [i18n-runtime-strategy.md](i18n-runtime-strategy.md) — message
  translations via Paraglide
- [admin-ui-patterns.md](admin-ui-patterns.md) — operator-broadcast
  notifications
- [ADR-0037](../adr/0037-sse-native-default.md) — SSE as realtime default
- [ADR-0019](../adr/0019-error-model.md) — ProblemError for delivery failures

## When to use what — decision tree

```text
Response to user's own action (saved, copied)     → toast.md (ephemeral)
Error needing user attention (save failed)         → toast.md + error-boundary.md
Long-running job done (export ready)               → notification center (THIS) + optional web-push
Another user acted (comment, mention, assign)      → notification center (THIS)
Security event (new login, password change)        → notification center + mandatory email
Marketing / product announcement                   → notification center (consent-gated) + email opt-in
Transactional email only (receipt, invoice)       → structured-emails.md — no center row
System-wide outage alert                           → banner.md (not a notification)
Operator broadcast to one tenant                   → notification center, operator-authored via admin
```

## Three build rules

1. **Notifications are events, not messages.** The center stores an
   event (`{type, actorId, targetId, meta}`); render templates + i18n
   turn it into text at display time. Never store the rendered string.
2. **Channels are derived from user preferences, not hardcoded.**
   Every notification type has a default channel set; users can
   override per-type; preferences travel with the event to the
   fan-out worker.
3. **Idempotency is mandatory at fan-out.** The same event must not
   produce two in-app rows, two emails, two pushes. `dedupeKey` is
   an intrinsic part of every emit.

## Shape — bounded Zod

```ts
// packages/notifications/src/types.ts
import { z } from 'zod';

export const NotificationType = z.enum([
  'comment.mentioned',
  'comment.replied',
  'item.assigned',
  'item.shared',
  'invite.received',
  'invite.accepted',
  'export.ready',
  'report.ready',
  'security.new_login',
  'security.password_changed',
  'security.mfa_changed',
  'billing.payment_failed',
  'billing.renewal_upcoming',
  'system.maintenance',
  'marketing.product_update',
]);
export type NotificationType = z.infer<typeof NotificationType>;

export const Channel = z.enum(['in_app', 'email', 'push', 'sms']);
export type Channel = z.infer<typeof Channel>;

export const Priority = z.enum(['low', 'normal', 'high', 'critical']);
export type Priority = z.infer<typeof Priority>;

export const NotificationEvent = z.object({
  id: z.string().uuid(),
  type: NotificationType,
  recipientId: z.string().uuid(),
  actorId: z.string().uuid().optional(),
  targetId: z.string().optional(),
  meta: z.record(z.unknown()).refine(
    (m) => JSON.stringify(m).length <= 4096,
    'meta exceeds 4KB',
  ),
  dedupeKey: z.string().min(8).max(128),
  priority: Priority,
  createdAt: z.string().datetime(),
});
export type NotificationEvent = z.infer<typeof NotificationEvent>;

export const InAppRow = z.object({
  id: z.string().uuid(),
  eventId: z.string().uuid(),
  recipientId: z.string().uuid(),
  readAt: z.string().datetime().nullable(),
  dismissedAt: z.string().datetime().nullable(),
  deliveredAt: z.string().datetime(),
  type: NotificationType,
  priority: Priority,
  groupKey: z.string().optional(),
});
export type InAppRow = z.infer<typeof InAppRow>;
```

Seven shape rules:

1. **`type` is a bounded enum** — per
   [schemas.md](schemas.md). Free-form types explode OTel
   cardinality and translation key count.
2. **`meta` is opaque key/value capped at 4KB** — enough for IDs +
   labels, not enough for embedded bodies. Bodies live in their
   source entity (fetched at render time).
3. **`dedupeKey` is mandatory** — intrinsic to the event. The
   worker uses it to drop duplicate fan-outs. Typical shape:
   `${type}:${recipientId}:${contextId}`.
4. **Separate `NotificationEvent` (write side) from `InAppRow`
   (read side)** — the event is the source of truth; in-app rows
   are the materialized projection for that channel.
5. **`groupKey`** controls collapse ("3 new comments on this
   document"); missing = never collapsed.
6. **`priority` is bounded** — drives delivery timing (critical
   bypasses batching), channel choice, UI emphasis.
7. **No raw strings** — no `title`, no `body`, no `url`. The
   render layer derives those from `type + meta`.

## Delivery preferences — user-controlled routing

```ts
// packages/notifications/src/preferences.ts
export const DeliveryRule = z.object({
  type: NotificationType,
  channels: z.array(Channel).min(1),
  mode: z.enum(['instant', 'batched_15m', 'batched_hourly', 'daily_digest', 'off']),
});

export const UserPreferences = z.object({
  userId: z.string().uuid(),
  timezone: z.string(),
  quietHours: z.object({
    start: z.string().regex(/^\d{2}:\d{2}$/),
    end: z.string().regex(/^\d{2}:\d{2}$/),
  }).optional(),
  rules: z.array(DeliveryRule),
  marketingOptIn: z.boolean().default(false),
});
```

Seven preference rules:

1. **Per-type rules, never one global switch** — users want
   security emails but not marketing; the matrix is the whole point.
2. **`security.*` rules cannot be turned off** — enforced in Zod
   refine: security critical notifications override preference. The
   UI shows them as non-toggleable.
3. **`quietHours`** delays non-critical deliveries until `end`;
   the worker carries the user's timezone from preferences, never
   from the request.
4. **`marketingOptIn` is separate from per-type rules** —
   regulated by consent (CAN-SPAM, GDPR). The flag is independently
   revocable + audited.
5. **Default preferences are conservative** — instant in-app for
   everything; email for security + explicit opt-in; push off
   until the user requests permission; SMS only for billing after
   phone verification.
6. **Preference changes audited** — `preferences.changed` event
   with before/after. Disputes around "I never opted in" are
   settled by the log.
7. **Preferences travel with the event** — the enqueue reads
   preferences at the time of event creation and attaches them to
   the job payload. Prevents preference races with in-flight
   events.

## Fan-out worker

```ts
// packages/notifications/src/fanout.ts
import { makeWorker } from '$lib/server/queue';
import { db } from '$lib/server/db';
import { clock } from '@sveltesentio/core/clock';
import { NotificationEvent, UserPreferences } from './types';
import { z } from 'zod';

const Payload = z.object({
  event: NotificationEvent,
  preferences: UserPreferences,
});

export const fanoutWorker = makeWorker(
  'notifications.fanout',
  Payload,
  async ({ event, preferences }) => {
    const existing = await db.notifications.findByDedupeKey(event.dedupeKey);
    if (existing) return { skipped: 'duplicate' };

    const rule = preferences.rules.find((r) => r.type === event.type);
    if (!rule || rule.mode === 'off') {
      return { skipped: 'user_opt_out' };
    }

    const inQuiet = inQuietHours(preferences, clock.now());
    const isCritical = event.priority === 'critical';

    const channels = rule.channels;
    const delays = channels.map((c) => scheduleFor(c, rule.mode, inQuiet, isCritical));

    await db.transaction(async (tx) => {
      if (channels.includes('in_app')) {
        await tx.notifications.insertInApp(event);
      }
      await tx.notificationEvents.insert({ ...event, fannedOutAt: clock.now().toISOString() });
    });

    for (const { channel, delayMs } of delays) {
      await queue.enqueue(`notifications.deliver.${channel}`, event, {
        jobId: `${channel}:${event.dedupeKey}`,
        delay: delayMs,
      });
    }

    await emitUnreadCountUpdate(event.recipientId);
    return { delivered: channels };
  },
);
```

Eight fan-out rules:

1. **`dedupeKey` check is the first act** — before doing any work;
   an idempotent enqueue is not enough when preferences change
   between retries.
2. **Preference lookup is from the payload** — not from the DB
   (which may have changed since enqueue). Determinism > recency.
3. **`critical` priority bypasses quiet hours + batching** — but
   you must justify every type that maps to `critical` (security
   events, payment failures).
4. **Per-channel enqueue with `jobId` dedupe** — email + push +
   in-app each have their own downstream job; `${channel}:
   ${dedupeKey}` makes re-execution safe.
5. **In-app row written atomically with event write** — same DB
   tx. The UI must never see a phantom event without its in-app
   row.
6. **`emitUnreadCountUpdate` after commit** — publish to SSE
   channel so the badge updates live. Pre-commit publish risks
   phantom counts on rollback.
7. **No raw strings assembled here** — the channel worker does
   template rendering with the user's locale at delivery time.
8. **Return value is structured** — `{ delivered: [...] }` or
   `{ skipped: reason }`; observability labels come from these.

## Batching modes

Four batching rules:

1. **`instant`** — delivered immediately; used for critical +
   direct mentions + 1:1 messages.
2. **`batched_15m` / `batched_hourly`** — fan-out holds the event
   in a time-bucketed queue; at bucket close, collapse events
   with the same `groupKey` into one message ("3 new comments on
   X"). The in-app row is still written at event time; only the
   email/push channel is batched.
3. **`daily_digest`** — fan-out writes the in-app row immediately
   but suppresses all other channels; a scheduled cron job (per
   [cron-jobs.md](cron-jobs.md)) at the user's morning hour (08:00
   in `preferences.timezone`) sends a single summary email.
4. **Bucket close is a separate worker** — reads the bucket key
   (`user:${id}:window:${start}`), aggregates, renders one
   message, emits to the channel worker. Uses Redis sorted sets
   or pg table-per-window; idempotent by bucket key.

## Realtime surface — SSE

```ts
// src/routes/api/notifications/stream/+server.ts
import { produce } from '$lib/server/sse';
import { db } from '$lib/server/db';

export async function GET({ locals }) {
  const user = requireUser(locals);
  return produce(async ({ emit, close, signal }) => {
    const initial = await db.notifications.unreadCount(user.id);
    emit({ event: 'unread_count', data: String(initial) });

    const sub = await db.notifications.subscribe(user.id, signal);
    for await (const update of sub) {
      emit({ event: 'update', data: JSON.stringify(update) });
    }
    close();
  });
}
```

Six realtime rules:

1. **Initial unread count on connect** — prevents flicker (badge
   showing 0 then jumping to 7).
2. **Event type `unread_count`** vs. `update` vs. `new` —
   semantics per event; consumer chooses what to redraw.
3. **`signal` propagates disconnect** — DB subscription cleans up
   when the SSE stream closes. No zombie listeners.
4. **Heartbeat every 15s** per [sse.md](sse.md) so proxies don't
   close idle connections.
5. **One stream per user** — not per tab. Tabs share via
   `BroadcastChannel` so backend fans out once.
6. **Fallback polling on SSE-unsupported envs** — `useNotifications`
   rune falls back to 60s `GET /api/notifications/unread` when the
   SSE connect fails twice.

## Client rune

```ts
// packages/notifications/src/useNotifications.svelte.ts
import { on } from 'svelte/events';

export function useNotifications() {
  let unreadCount = $state(0);
  let items = $state<InAppRow[]>([]);
  let open = $state(false);

  $effect(() => {
    const es = new EventSource('/api/notifications/stream');
    const offCount = on(es, 'unread_count', (e) => {
      unreadCount = Number((e as MessageEvent).data);
    });
    const offUpdate = on(es, 'update', (e) => {
      const row = InAppRow.parse(JSON.parse((e as MessageEvent).data));
      items = [row, ...items];
    });
    return () => { offCount(); offUpdate(); es.close(); };
  });

  async function markRead(id: string) {
    await fetch('/api/notifications/' + id + '/read', { method: 'POST' });
    items = items.map((r) => r.id === id ? { ...r, readAt: new Date().toISOString() } : r);
    unreadCount = Math.max(0, unreadCount - 1);
  }

  async function markAllRead() {
    await fetch('/api/notifications/read-all', { method: 'POST' });
    const now = new Date().toISOString();
    items = items.map((r) => r.readAt ? r : { ...r, readAt: now });
    unreadCount = 0;
  }

  async function dismiss(id: string) {
    await fetch('/api/notifications/' + id + '/dismiss', { method: 'POST' });
    items = items.filter((r) => r.id !== id);
  }

  return {
    get unreadCount() { return unreadCount; },
    get items() { return items; },
    get open() { return open; },
    toggle: () => open = !open,
    markRead,
    markAllRead,
    dismiss,
  };
}
```

Six rune rules:

1. **Optimistic read/dismiss** — UI updates before the server
   confirms; roll back only on 4xx/5xx.
2. **`InAppRow.parse()` on every incoming message** — SSE payload
   from the server is validated client-side; untrusted until proven
   otherwise even from own backend.
3. **Server returns full row on read ack** — prevents drift if
   the DB computes server-side timestamps.
4. **Never store event body in client state** — only the event
   id + type + rendered-preview; click opens the source entity.
5. **`$effect` with `EventSource` inside** — no globals; each
   component owner gets its own stream; teardown on unmount
   prevents leaks.
6. **Fallback `visibilitychange` refetch** — on tab focus, if the
   stream was suspended, refetch unread count to correct for any
   missed events.

## Rendering — templates with i18n

```ts
// packages/notifications/src/render.ts
import * as m from '$lib/paraglide/messages';

export function renderNotification(row: InAppRow): { title: string; href: string } {
  switch (row.type) {
    case 'comment.mentioned':
      return {
        title: m.notif_comment_mentioned({
          actor: row.meta.actorName as string,
          doc: row.meta.docTitle as string,
        }),
        href: `/documents/${row.meta.docId}#comment-${row.meta.commentId}`,
      };
    case 'item.assigned':
      return {
        title: m.notif_item_assigned({ item: row.meta.itemTitle as string }),
        href: `/items/${row.meta.itemId}`,
      };
    // exhaustive over NotificationType — TS errors on missing case
  }
}
```

Five render rules:

1. **Exhaustive switch over `NotificationType`** — TypeScript
   ensures every type has a renderer; `default: assertNever(row.type)`
   catches additions at compile time.
2. **Paraglide messages for every type** — per
   [i18n-runtime-strategy.md](i18n-runtime-strategy.md). Never
   concat strings.
3. **Render at display time, not at event time** — users switch
   locales; old notifications re-render in the new language.
4. **`href` is a deep link** not a template URL — opens exactly
   the item in context.
5. **Sanitize any user-authored `meta`** — actor name, doc title
   must pass through DOMPurify (via [trusted-types.md](trusted-types.md))
   if the template allows HTML. Default templates are text-only.

## Grouping and collapse

```ts
// packages/notifications/src/group.ts
export function collapse(items: InAppRow[]): Group[] {
  const out: Record<string, Group> = {};
  for (const row of items) {
    const key = row.groupKey ?? row.id;
    const g = out[key] ??= { key, items: [], latestAt: row.deliveredAt };
    g.items.push(row);
    if (row.deliveredAt > g.latestAt) g.latestAt = row.deliveredAt;
  }
  return Object.values(out).sort((a, b) => b.latestAt.localeCompare(a.latestAt));
}
```

Five grouping rules:

1. **`groupKey` is set at event emit time** — typically
   `${type}:${contextId}`; controlled by the emitter not the UI.
2. **Collapse shows count + "latest N seconds ago"** — not a
   wall of repeated rows.
3. **Expanding a group shows all rows** — collapse is a UI
   optimization, not data loss.
4. **Grouped rows share read state by collapse** — marking the
   group read marks every contained row read; opening any child
   marks only that child.
5. **Read/dismiss events fire once per collapse action** — never
   N events for a group of N.

## A11y invariants

Seven a11y rules:

1. **Bell button `role="button"` + `aria-expanded`** +
   `aria-controls="notifications-panel"` + `aria-haspopup="dialog"`.
2. **Unread badge has `aria-label="{count} unread notifications"`**
   — not just numeric text; SR users hear intent.
3. **Panel is `role="dialog"` `aria-label="Notifications"`** with
   focus trap + Esc to close + initial focus on first unread item.
4. **Live updates are `aria-live="polite"`** on the count; **not
   assertive** — we don't interrupt SR users every 30 seconds.
5. **Each item is `<button>`-like and has a full label** ("New
   comment on Doc X by User Y, 3 minutes ago").
6. **Keyboard navigation** — arrow up/down between items, Enter
   opens, Delete dismisses, R marks read. Shortcuts documented in
   the command palette.
7. **Reduced motion** — no slide-in animation for new items
   under `prefers-reduced-motion: reduce`; fade only.

## Channel interaction — toast vs center vs push

Five interaction rules:

1. **Center row is always written** for non-ephemeral events;
   toast is an optional *additional* surface for the same event
   when the user is live in-app.
2. **Push is a user-permission feature** — never assumed; the app
   never asks for notification permission until the user has
   opted into push in settings.
3. **Email is suppressed when user is live in-app for batched
   types** — a "seen by recipient" flag on the event (user viewed
   the item in the 15min window) cancels the email send.
4. **SMS only for billing + 2FA** — hardcoded whitelist; cost +
   regulatory gates make SMS a special channel.
5. **Cross-device dedupe** — if the user reads the notification
   on mobile, desktop updates the badge via SSE within seconds.

## Security invariants

Six security rules:

1. **Recipient id is server-derived** — the event emitter provides
   the context; the fan-out worker looks up who is mentioned /
   assigned / relevant; clients never pass `recipientId`.
2. **`meta` contents sanitized at render** — user-authored fields
   (actor name, doc title) pass through DOMPurify + Zod + max-length
   before being interpolated.
3. **Rate-limit emits per-emitter** — prevents mass-mention abuse
   ("@everyone" = 10k notifications). Cap per user per hour.
4. **No PII in `dedupeKey`** — dedup keys often land in logs;
   use UUIDs or hashes not emails.
5. **Email unsubscribe links are signed** — per
   [structured-emails.md](structured-emails.md) RFC 8058 one-click
   unsubscribe, honored server-side within seconds.
6. **Marketing notifications double-gated** — C3 consent +
   per-type preference; both required to send.

## Observability

Bounded attributes only:

```ts
export const NOTIFICATION_ATTRIBUTES = [
  'notification.type',            // ≤20 values, enum
  'notification.channel',         // in_app | email | push | sms
  'notification.priority',        // low | normal | high | critical
  'notification.outcome',         // delivered | skipped_opt_out | skipped_dup | failed
  'notification.batch_mode',      // instant | batched_15m | batched_hourly | daily_digest | off
  'notification.group_collapsed', // 1 | 2-5 | 6-20 | 21+
] as const;
```

Six alerts:

1. **Fan-out failure rate > 0.5% / 5min** → page on-call.
2. **Email delivery failure rate > 2% / hour** → email infra.
3. **SSE stream error rate > 5% / 5min** → realtime perf.
4. **Daily digest skew > 10 minutes past scheduled window** → cron
   backlog.
5. **Unread count divergence > 1% between DB and SSE-sourced
   client** → worker / publish race.
6. **Marketing send without C3 consent** → stop-the-line,
   regulatory page.

## Testing

Six testing lanes:

1. **Unit — exhaustive render** — every `NotificationType` has a
   render case; snapshot test asserts every enum value is covered.
2. **Integration — fan-out dedupe** via testcontainers: emit
   same event twice, one in-app row + one email, not two.
3. **Integration — preferences respected** — off + quiet hours +
   per-type routing tests.
4. **E2E — bell → open → read → dismiss** with Playwright;
   unread count syncs.
5. **Realtime — cross-tab dedupe** — two tabs, read on one, badge
   updates on the other within 2s.
6. **A11y — axe clean** on bell + panel + items; keyboard
   navigation tested with Playwright `keyboard` fixture.

## Anti-patterns

1. **Rendered strings in the event** — `"John mentioned you in
   Docs/Q2 Plan"` stored in DB. Translates wrong, rots when names
   change, leaks in backups.
2. **Free-form `type` field** — cardinality explodes in OTel;
   translation table becomes unbounded; render switch impossible
   to exhaust.
3. **One notification row per delivery channel** — denormalized
   storage creates 3x rows for the same event; read-state
   inconsistent across channels.
4. **Polling `/api/notifications/unread` every 5s** — heat +
   battery; use SSE + fallback only when SSE fails.
5. **Unread count drift** — UI decrements optimistically, server
   doesn't confirm, count goes negative. Clamp to `max(0, …)`;
   reconcile on tab focus.
6. **No `dedupeKey`** — retries produce duplicate notifications;
   users see 3 of the same; support tickets flood.
7. **Marketing sent without consent check** — regulatory
   violation + reputation damage.
8. **No unsubscribe link in email** — RFC 8058 violation; email
   providers bounce.
9. **"One-click" unsubscribe that requires a form submit** —
   defeats RFC 8058; inboxes mark as spam.
10. **Security notifications toggleable off** — user disables,
    misses their own password change, gets hacked, sues.
11. **Quiet hours applied to critical events** — user misses
    payment failure; subscription lapses.
12. **Timezone pulled from browser at fan-out time** — server
    batches for the wrong midnight; digest emails arrive at 3am.
    Use `preferences.timezone`.
13. **`meta` used as a dumping ground** — 100KB strings, entire
    document bodies. 4KB cap enforced in Zod.
14. **In-app row before event write** — event write fails; UI
    shows a row referencing a non-existent event.
15. **No exhaustive TS switch over `NotificationType`** — adding
    a type forgets the renderer; users see "undefined" in the
    bell.
16. **Push notifications for low-priority events** — OS-level
    spam; users disable the entire app's permission; push is dead.
17. **Collapse without a count** — "new comments on X" hides how
    many; users click to find out; friction.
18. **Read-all without confirmation at scale** — user has 2,000
    unread; click marks all; lose track of which they hadn't seen.
    Offer Undo (5s) or require confirm >50.
19. **Email batch bundling unrelated events** — "You have updates"
    as the subject line; engagement tanks. Group by type + context
    only.
20. **Cross-tenant notification leak** — emit scope not validated;
    user in tenant A gets notified about tenant B's mention; data
    leak.
21. **Live SSE sends rendered HTML** — server changes rendering,
    cached clients show stale. Send structured event; render on
    client.
22. **No `jobId` dedupe at downstream channel workers** —
    fan-out retries send 5 emails for one event.
23. **Unbounded retention** — notifications from 2 years ago
    clog the UI. Auto-archive read + >90 days; delete >1 year.
24. **Marketing + transactional in one template** — CAN-SPAM
    distinction matters; separate tables + separate unsubscribe
    scopes.

## References

- RFC 8058 — one-click email unsubscribe
  <https://datatracker.ietf.org/doc/html/rfc8058>
- CAN-SPAM Act — commercial email rules
  <https://www.ftc.gov/legal-library/browse/rules/can-spam-rule>
- Web Push — IETF spec
  <https://datatracker.ietf.org/doc/html/rfc8030>
- W3C Notifications API
  <https://notifications.spec.whatwg.org/>
- [ADR-0037](../adr/0037-sse-native-default.md) — SSE default
- [ADR-0019](../adr/0019-error-model.md) — ProblemError
- [sse.md](sse.md)
- [web-push.md](web-push.md)
- [toast.md](toast.md)
- [queue-workers.md](queue-workers.md)
- [structured-emails.md](structured-emails.md)
- [consent-management.md](consent-management.md)
- [i18n-runtime-strategy.md](i18n-runtime-strategy.md)
- [admin-ui-patterns.md](admin-ui-patterns.md)
