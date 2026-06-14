# Outbound webhooks — signed delivery + retries + subscription UI

> Sender-side HTTP webhooks: the app publishes signed events to
> customer-configured URLs. Composes
> [webhooks.md](webhooks.md) (inbound counterpart),
> [queue-workers.md](queue-workers.md) for delivery workers,
> [audit-log.md](audit-log.md) for subscription changes,
> [rate-limiting.md](rate-limiting.md) for per-endpoint caps,
> [admin-ui-patterns.md](admin-ui-patterns.md) for operator
> diagnostics, [secrets-management.md](secrets-management.md) for
> signing keys, and [structured-emails.md](structured-emails.md)
> for delivery-failure notices. Every outbound delivery is
> **HMAC-signed, retried with exponential backoff + jitter,
> idempotent at the receiver, observable end-to-end**, and
> **customer-pausable** within seconds.

Outbound webhooks are **your public async API**. A flaky one
drives customers to switch vendors; a correct one lets their
systems react in real time. The patterns below prioritize
**signature discipline, retry sanity, and sender-side
observability** over feature velocity.

## Related

- [webhooks.md](webhooks.md) — inbound (receiver-side) companion
- [queue-workers.md](queue-workers.md) — delivery worker per endpoint
- [audit-log.md](audit-log.md) — subscription create/update/delete trail
- [rate-limiting.md](rate-limiting.md) — per-endpoint throttle
- [admin-ui-patterns.md](admin-ui-patterns.md) — operator diagnostics
- [secrets-management.md](secrets-management.md) — HMAC signing keys
- [structured-emails.md](structured-emails.md) — failure notifications
- [api-versioning.md](api-versioning.md) — event schema versions
- [service-limits.md](service-limits.md) — per-plan subscription caps
- [observability.md](observability.md) — delivery metrics
- [ADR-0019](../adr/0019-error-model.md) — ProblemError for subscribe API
- [ADR-0023](../adr/0023-uuidv7-default.md) — event + delivery ids

## When to use what — decision tree

```text
Integrator needs real-time event notifications       → outbound webhook (THIS)
Browser UI needs real-time updates                    → sse.md
Backend-to-backend streaming (low latency)            → connectrpc.md
Agent has to poll because no webhooks                 → your webhook API is missing; build it
One-off notification (email / SMS)                    → notifications-center.md
Many consumers of one event                           → pub/sub (internal) → outbound fans out to subscribers
Event needs guaranteed in-order delivery              → ordering contract + single-partition queue
Integrator unable to receive webhooks                  → offer polling endpoint on top (deprecated)
```

## Three build rules

1. **Every delivery is HMAC-signed** with a per-subscription
   secret. Receivers verify with constant-time compare. No
   signature, no trust.
2. **Idempotency is the receiver's contract.** Senders deliver at
   least once; receivers deduplicate by `X-Webhook-Event-Id`.
   Document this.
3. **Subscriptions are explicit, typed, auditable.** Event-type
   allow-list, URL schema validation, owner, state, secret
   rotation, pause button.

## Event model

```ts
// packages/webhooks/src/events.ts
import { z } from 'zod';

export const EventType = z.enum([
  'user.created',
  'user.updated',
  'user.deleted',
  'order.placed',
  'order.paid',
  'order.refunded',
  'invoice.generated',
  'subscription.canceled',
  'tenant.plan_changed',
]);

export const OutboundEvent = z.object({
  id: z.string().uuid(),
  type: EventType,
  version: z.number().int().min(1).max(99),
  tenantId: z.string().uuid(),
  occurredAt: z.string().datetime(),
  data: z.record(z.unknown()).refine(
    (d) => JSON.stringify(d).length <= 64 * 1024,
    'payload exceeds 64KB',
  ),
});
```

Six event rules:

1. **Bounded `EventType` enum** per
   [schemas.md](schemas.md) — integrators code against a known
   list; free-form types explode consumer parsers.
2. **`version` integer 1-99** per event type — schema evolves
   additively with major-version bumps for breaking changes.
3. **`id` is UUIDv7** — chronologically sortable; receivers use
   it as the dedupe key.
4. **`tenantId` present on every event** — multi-tenant routing
   + filtering; never ambient-derived by the consumer.
5. **`data` ≤ 64KB** — bodies bigger than this belong as object-
   storage references, not inline payload.
6. **`occurredAt` from the domain event's source** — not
   "delivery time"; integrator sees the real timestamp.

## Subscription model

```ts
// packages/webhooks/src/subscriptions.ts
import { z } from 'zod';

export const SubscriptionStatus = z.enum(['active', 'paused', 'disabled_by_ops', 'disabled_by_failures']);

export const Subscription = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  url: z.string().url().refine(
    (u) => u.startsWith('https://') && !isInternalHost(u),
    'must be https public host',
  ),
  eventTypes: z.array(EventType).min(1).max(50),
  secretHashed: z.string().length(64),
  createdAt: z.string().datetime(),
  createdBy: z.string().uuid(),
  status: SubscriptionStatus,
  pauseReason: z.string().max(200).optional(),
  lastSuccessAt: z.string().datetime().nullable(),
  lastFailureAt: z.string().datetime().nullable(),
  failureStreak: z.number().int().nonnegative().max(1_000_000),
  description: z.string().max(200).optional(),
});
```

Seven subscription rules:

1. **HTTPS-only** URL — HTTP plaintext is rejected at subscribe
   time. No localhost, RFC1918, `.internal` — SSRF defense at
   the boundary.
2. **Per-event-type subscriptions bounded 1-50** — prevents
   catch-all firehoses that amplify blast radius on a bug.
3. **`secret` hashed at rest** (SHA-256), raw shown **once** on
   creation. Rotation creates a second key; old key valid for a
   grace period.
4. **Four statuses** track lifecycle: `active`, `paused` (user),
   `disabled_by_ops` (support action), `disabled_by_failures`
   (auto after N consecutive failures).
5. **`failureStreak`** resets on any success; threshold (e.g.,
   1000) flips to `disabled_by_failures` + emails owner.
6. **`createdBy` audited** — subscription created by which user
   or API key. Investigations require this.
7. **`url` validated at create, re-validated at delivery** — DNS
   can change; re-check keeps the SSRF defense current.

## SSRF defense

```ts
// packages/webhooks/src/ssrf.ts
import dns from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

export async function assertPublicHost(url: URL): Promise<void> {
  if (url.protocol !== 'https:') throw new Error('https_required');
  const addrs = await dns.resolve(url.hostname);
  for (const a of addrs) {
    const ip = ipaddr.parse(a);
    if (ip.range() !== 'unicast' || isBogon(ip)) throw new Error('private_host');
  }
}
```

Six SSRF rules:

1. **`https://` only** — plaintext leaks signatures + payloads.
2. **DNS resolved at send time** — rebinding attacks foiled by
   re-resolution per delivery.
3. **All resolved IPs checked** — a hostname resolving to one
   public + one private IP is still rejected.
4. **Bogon + RFC1918 + link-local + loopback blocked** —
   `0.0.0.0/8`, `10/8`, `127/8`, `169.254/16`, `192.168/16`, etc.
5. **Cloud-metadata IPs blocked** — `169.254.169.254`,
   `fd00:ec2::254`. Any delivery targeting metadata is lethal.
6. **Per-region allowlist** available for enterprise — the
   customer declares their endpoint subnet; ops approves after
   verification.

## Dispatcher — from event bus to per-subscription job

```ts
// packages/webhooks/src/dispatch.ts
export async function dispatch(event: OutboundEvent) {
  const subs = await db.subscriptions.findForEvent(event.tenantId, event.type);
  for (const sub of subs) {
    if (sub.status !== 'active') continue;
    await queue.enqueue('webhook.deliver', {
      subscriptionId: sub.id,
      eventId: event.id,
    }, {
      jobId: `deliver:${sub.id}:${event.id}`,
      attempts: 12,
      backoff: { type: 'exponential', delay: 1000 },
    });
  }
}
```

Six dispatcher rules:

1. **One queue job per `subscription × event`** — delivery
   concurrency is per-subscription; one slow endpoint does not
   block others.
2. **`jobId = deliver:<subId>:<eventId>`** — dedup; double
   publishing of the same event does not create two deliveries.
3. **`status !== 'active'`** skipped, not queued — paused
   subscriptions do not silently backlog; events are missed by
   design (or buffered if the plan says so; document explicitly).
4. **Event + subscription loaded from DB**, not the payload —
   payload is minimal (ids only), worker fetches fresh state.
5. **Dispatch runs post-commit** of the domain event — never
   enqueue inside the user-facing transaction; crash between
   enqueue + commit loses the event. Use an outbox pattern per
   [queue-workers.md](queue-workers.md).
6. **Per-subscription concurrency = 1** by default — preserves
   per-subscription ordering of events; opt-in to higher on
   request.

## Delivery worker

```ts
// packages/webhooks/src/worker.ts
import { makeWorker } from '$lib/server/queue';
import { z } from 'zod';
import { sign } from './sign';
import { db } from '$lib/server/db';
import { fetch } from 'undici';
import { clock } from '@sveltesentio/core/clock';

const Payload = z.object({
  subscriptionId: z.string().uuid(),
  eventId: z.string().uuid(),
});

export const deliveryWorker = makeWorker(
  'webhook.deliver',
  Payload,
  async ({ subscriptionId, eventId }) => {
    const [sub, event] = await Promise.all([
      db.subscriptions.findById(subscriptionId),
      db.events.findById(eventId),
    ]);
    if (!sub || sub.status !== 'active') return { skipped: 'not_active' };

    await assertPublicHost(new URL(sub.url));

    const body = JSON.stringify(event);
    const timestamp = String(Math.floor(clock.now().getTime() / 1000));
    const secret = await db.secrets.getRaw(sub.id);
    const signature = sign(secret, timestamp, body);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(sub.url, {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': `sveltesentio-webhooks/1.0 (+${PUBLIC_ORIGIN}/webhooks)`,
          'X-Webhook-Id': sub.id,
          'X-Webhook-Event-Id': event.id,
          'X-Webhook-Event-Type': event.type,
          'X-Webhook-Timestamp': timestamp,
          'X-Webhook-Signature': `v1=${signature}`,
          'Idempotency-Key': event.id,
        },
        signal: controller.signal,
      });
      await recordDelivery(sub, event, res.status);
      if (res.status >= 200 && res.status < 300) return { delivered: true };
      if (res.status === 410) {
        await db.subscriptions.setStatus(sub.id, 'disabled_by_ops', '410 Gone');
        return { disabled: true };
      }
      throw new Error(`status ${res.status}`);
    } finally {
      clearTimeout(timeout);
    }
  },
);
```

Ten worker rules:

1. **Re-fetch subscription + event on every attempt** — a paused
   subscription must not re-deliver from a retry queue.
2. **SSRF re-check per attempt** — DNS could have drifted since
   enqueue.
3. **10-second timeout** — slow receivers do not starve the
   worker pool.
4. **`X-Webhook-Timestamp`** as seconds, signed + transmitted —
   receivers reject requests older than 5 min (replay defense).
5. **`X-Webhook-Signature: v1=<hex>`** — versioned so rotation
   to v2 schemes is possible without breaking receivers.
6. **`Idempotency-Key: <eventId>`** — receivers key their
   dedupe table by this.
7. **200-299** success; **410 Gone** → auto-disable (endpoint
   permanently removed); **400-499** excluding 408/429 → do not
   retry (receiver bug); **5xx / network / 408 / 429** → retry.
8. **Honor `Retry-After` header** on 429/503 — respect
   receiver's backpressure.
9. **Record delivery row** before return — success or failure
   leaves a row (id, status, duration, response size sample).
10. **Never log full body at INFO** — payloads contain PII;
    DEBUG-only and redacted.

## Signing scheme

```ts
// packages/webhooks/src/sign.ts
import { createHmac, timingSafeEqual } from 'node:crypto';

export function sign(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export function verify(
  secret: string,
  timestamp: string,
  body: string,
  headerSig: string,
): boolean {
  const expected = sign(secret, timestamp, body);
  const v1 = headerSig.startsWith('v1=') ? headerSig.slice(3) : '';
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(v1, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
```

Seven signing rules:

1. **HMAC-SHA256** — well-vetted; matches Stripe/GitHub/Slack
   conventions integrators already know.
2. **Timestamp prefix `${ts}.${body}`** — stops replay of a
   valid signature with a stale timestamp.
3. **`timingSafeEqual`** — constant-time comparison; leaking via
   timing is a real attack in practice.
4. **Hex encoding** — URL/log-safe. Base64 is fine too, but pick
   one and document.
5. **`v1=` prefix** — version the scheme; a future v2 (e.g.,
   Ed25519) coexists during rotation.
6. **Per-subscription secret** — one leak does not affect other
   subscriptions. Rotate without impacting neighbors.
7. **Receivers verify with** body-as-bytes, not parsed-JSON —
   re-serialization would change bytes.

## Secret rotation

```ts
// packages/webhooks/src/rotate.ts
export async function rotateSecret(subId: string): Promise<{ raw: string }> {
  const newRaw = randomBytes(32).toString('hex');
  await db.transaction(async (tx) => {
    await tx.secrets.insert({ subId, key: await hash(newRaw), activeFrom: clock.now().toISOString() });
    // old key remains valid for grace period (24h); worker signs with both during rotation
  });
  return { raw: newRaw };
}
```

Six rotation rules:

1. **Grace period** (24h default) — both old and new keys sign
   deliveries; receivers update at leisure.
2. **Old key revoked after grace** — scheduled worker sweeps and
   removes.
3. **Secret shown once** — UI never shows it again; forces the
   user to store it safely.
4. **Audit event** — `subscription.secret_rotated` with actor.
5. **Ops cannot read the raw secret** — stored one-way hashed;
   rotation forces regenerate.
6. **CLI + API both trigger rotation** — not UI-only.

## Auto-disable on chronic failure

Six auto-disable rules:

1. **`failureStreak >= 1000`** → `disabled_by_failures`; email
   owner; audit event.
2. **`failureStreak`** is **consecutive** failures; a single
   success resets.
3. **Disabled subscriptions** stop queuing new deliveries;
   in-flight retries run to exhaustion and are dropped.
4. **Re-enable** requires the owner to click "Test" and get a
   200 — proves the endpoint is back.
5. **On-disable email** includes the last failure status + first
   failure timestamp — actionable info.
6. **Operator can manually disable / re-enable** with reason via
   admin UI.

## Delivery log + replay

Six delivery-log rules:

1. **Per-delivery row** `{ deliveryId, subscriptionId, eventId,
   attempt, statusCode, durationMs, responseSample, errorClass }`
   with 30-day retention default.
2. **Admin UI lists recent deliveries** per subscription —
   filter by status, expand one row for full headers + response
   sample.
3. **"Replay this event"** button — fires a new delivery
   attempt; idempotent on receiver because event-id is stable.
4. **"Replay last N failures"** — operator triage. Audited.
5. **Response body sample** capped at 4KB — enough to see error
   messages, small enough to store.
6. **PII scrub in samples** — `[REDACTED]` known-sensitive
   headers + params; see
   [session-replay.md](session-replay.md) scrub discipline.

## Subscription API

```text
POST   /api/webhooks/subscriptions                  — create
GET    /api/webhooks/subscriptions                  — list (tenant-scoped)
GET    /api/webhooks/subscriptions/:id              — detail
PATCH  /api/webhooks/subscriptions/:id              — update url/events/status
POST   /api/webhooks/subscriptions/:id/rotate       — rotate secret
POST   /api/webhooks/subscriptions/:id/test         — send a sample event
POST   /api/webhooks/subscriptions/:id/deliveries/:did/replay
DELETE /api/webhooks/subscriptions/:id              — disable (soft-delete)
```

Six API rules:

1. **Zod on every boundary** — request + response schemas per
   [schemas.md](schemas.md).
2. **Tenant scoping enforced in `load`** — per
   [rbac-modeling.md](rbac-modeling.md); cross-tenant listing
   forbidden.
3. **Rate limit** per
   [rate-limiting.md](rate-limiting.md) — subscription
   mutations are rare; 60/min/tenant is plenty.
4. **Test event** uses a dedicated `webhook.test` event type —
   receivers can ignore it safely.
5. **Soft-delete only** — subscription history preserved for
   audit; hard delete is ops-only.
6. **ProblemError** per
   [ADR-0019](../adr/0019-error-model.md) — structured failures.

## UI — subscription management

Six UI rules:

1. **Per-subscription page** shows status, URL, event types,
   failure streak, last success, last failure, recent
   deliveries.
2. **"Pause" is a single click** — flips to `paused`; in-flight
   jobs drain.
3. **"Rotate secret" displays once** in a modal; copy-to-
   clipboard button; then never again.
4. **"Test event"** button sends a `webhook.test` — status
   shown inline.
5. **Failure list** with status, duration, timestamp; click to
   expand headers + response sample.
6. **Plan cap surfaced** — "5 of 10 subscriptions used" per
   [service-limits.md](service-limits.md).

## Ordering guarantees

Five ordering rules:

1. **Per-subscription concurrency = 1** by default → events
   deliver in-order-by-dispatch-time per subscription.
2. **`X-Webhook-Delivery-Sequence`** header — monotonically
   increasing per subscription; receivers can detect gaps or
   out-of-order.
3. **Ordering is best-effort**, not guaranteed — a failed +
   retried event may land after a newer event.
4. **Document ordering guarantees** on the public API docs —
   consumers must not assume strict ordering without explicit
   contract.
5. **If strict ordering is needed**, use a single-partition
   queue per subscription + refuse to parallelize retries.

## A11y for the UI

Six a11y rules:

1. **Subscription list is a `<table>`** per
   [data-tables.md](data-tables.md); status column has text +
   icon + color (not color-only).
2. **Status badges** have `aria-label` with full text
   ("Disabled, 3 consecutive failures").
3. **"Rotate secret" modal** is `role="alertdialog"`,
   focus-trapped.
4. **Copy-secret button** uses
   `navigator.clipboard.writeText()` + toast confirmation via
   [toast.md](toast.md); SR users hear "Copied".
5. **Test-event result** is `aria-live="polite"` — success /
   failure announced without page refresh.
6. **Keyboard shortcuts** documented in command palette — `Ctrl
   T` tests, `Ctrl R` rotates (where appropriate).

## Observability

Bounded attributes only:

```ts
export const WEBHOOK_ATTRIBUTES = [
  'webhook.subscription_id',   // bounded per tenant
  'webhook.event_type',        // bounded enum ≤50
  'webhook.outcome',           // delivered | retry | disabled | skipped
  'webhook.attempt_bucket',    // 1 | 2-5 | 6-10 | 11+
  'webhook.status_class',      // 2xx | 3xx | 4xx | 5xx | network
  'webhook.duration_bucket',   // <100ms | <1s | <5s | <10s | timeout
] as const;
```

Seven alerts:

1. **Global delivery success rate < 99% / 5min** → platform
   page.
2. **Per-subscription failure streak > 100** → owner email.
3. **Per-subscription failure streak > 1000** → auto-disable +
   email.
4. **Queue depth > 10k for >5min** → platform ops.
5. **p95 delivery latency > 3s** → receiver-side or network
   issue.
6. **Signature-verify failure at test endpoint > 0** → signing
   bug; stop-the-line.
7. **SSRF block count > 0** per 24h → security review; customer
   may be misconfigured.

## Testing

Seven testing lanes:

1. **Unit — `sign()` / `verify()`** with known vectors; constant-
   time compare verified.
2. **Unit — `assertPublicHost()`** covers every private range,
   metadata IP, rebinding scenario.
3. **Integration — worker** via testcontainers + a fake receiver
   (Express + tracking); success + retry + auto-disable paths
   asserted.
4. **Playwright — UI flows** create, pause, rotate, test, reply.
5. **Chaos — receiver drops 50% of responses** — worker retries
   and eventually succeeds; ordering preserved.
6. **Security — signature tamper** rejected; replay (old
   timestamp) rejected; SSRF attempt rejected.
7. **Performance — 10k events/minute** sustained delivery;
   queue stays drained.

## Anti-patterns

1. **No signature** — receivers accept forged events; data
   integrity impossible.
2. **Signature without timestamp** — replay attacks.
3. **`==` comparison for signatures** — timing attack extracts
   the key.
4. **No timeout on delivery** — one slow receiver starves the
   worker pool.
5. **No SSRF check** — subscription URL = `http://169.254.
   169.254/latest/meta-data/iam/security-credentials/` leaks
   cloud creds.
6. **Fire-and-forget with no retry** — transient receiver blip
   drops events permanently.
7. **Unbounded retries** — receiver dead for 6 months; queue
   fills forever.
8. **Retry on 4xx** — wastes budget; receiver bug; 400 is "do
   not retry".
9. **Retry on 410** — receiver removed endpoint; stop delivering.
10. **No `Retry-After` honor on 429** — receiver throttles you;
    ignoring amplifies the problem.
11. **Shared signing secret across subscriptions** — one leak
    compromises all.
12. **Secret shown more than once** — leaks via UI screenshot,
    support tickets.
13. **Secret stored reversible** — DB dump = account takeover of
    every subscription.
14. **Per-subscription concurrency = N** by default — breaks
    ordering without integrator opt-in.
15. **Body format that changes shape silently** — schema
    versioning required; never re-order keys (some receivers hash
    the stringified body and compare).
16. **`Content-Type: application/json` with non-JSON body** —
    receivers break.
17. **Including full PII in response-sample log** — GDPR /
    compliance violation.
18. **No auto-disable** — chronic-failure endpoints rack up
    millions of failed deliveries; no one notices.
19. **Auto-disable without owner notification** — customer wakes
    up with broken integration; blames the platform.
20. **Ordering promise in docs** without single-partition
    worker — broken expectation; support ticket stream.
21. **Webhook URL changes without validation** — attack vector
    for SSRF or exfiltration; re-validate on every PATCH.
22. **Mixing event schemas across versions in same stream** —
    include `version`; let consumers pin.
23. **Events reference ephemeral data** (signed URLs that expire
    before receiver processes) — include refresh hints or
    persistent IDs.
24. **No replay UI** — ops cannot help customers who missed
    events during their outage.
25. **Sending webhook-creation event via webhook** — infinite
    loop on bad config; exclude meta-events from delivery.

## References

- Stripe webhook signatures
  <https://docs.stripe.com/webhooks/signatures>
- GitHub webhook delivery model
  <https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks>
- Slack Events API reliability
  <https://api.slack.com/apis/connections/events-api>
- RFC 8941 — HTTP structured fields (for future `Signature`
  header alignment)
  <https://datatracker.ietf.org/doc/html/rfc8941>
- OWASP SSRF prevention
  <https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html>
- [ADR-0019](../adr/0019-error-model.md) — ProblemError
- [ADR-0023](../adr/0023-uuidv7-default.md) — UUIDv7 ids
- [webhooks.md](webhooks.md)
- [queue-workers.md](queue-workers.md)
- [audit-log.md](audit-log.md)
- [rate-limiting.md](rate-limiting.md)
- [admin-ui-patterns.md](admin-ui-patterns.md)
- [secrets-management.md](secrets-management.md)
- [api-versioning.md](api-versioning.md)
