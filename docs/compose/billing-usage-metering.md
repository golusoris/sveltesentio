# `billing-usage-metering.md` — usage-based billing recipe for sveltesentio

Beyond flat-rate subscriptions ([payments.md](payments.md)), modern
SaaS often charges per **usage unit** — API calls, GB-stored, seats-
active, AI-tokens-consumed, minutes-streamed. This recipe covers the
data path from "event happened" → "Stripe invoice item" via
event-emit → aggregation-window → idempotent reporter → overage-
alerts, per [ADR-0019](../adr/0019-server-runtime-contract.md) +
[ADR-0023](../adr/0023-compliance-observability.md).

The hard parts are **never the math** — they're **idempotency** (each
unit reported exactly once even after retries / duplicate webhooks),
**at-rest aggregation** (raw event firehose can be 1000×-1M× the
billable signal), **overage forecasting** (alert *before* the bill
shocks the customer), and **retroactive correction** (you find a
3-day metering bug — how do you fix yesterday's invoices safely).

## Related

- [payments.md](payments.md) — Stripe Elements/Checkout for plan
  subscriptions; this recipe layers metered items on top
- [tenant-provisioning.md](tenant-provisioning.md) — `PLAN_ENTITLEMENTS`
  declares quotas; this recipe meters consumption against them
- [service-limits.md](service-limits.md) — soft/hard quotas + 402
  envelope; metering and limits share the counter
- [audit-log.md](audit-log.md) — every metering correction logs
- [queue-workers.md](queue-workers.md) — aggregation + reporter run
  as workers
- [observability.md](observability.md) — usage events emit OTel spans
- [feature-flag-rollout-patterns.md](feature-flag-rollout-patterns.md) —
  staged rollout of new metered SKUs
- [ADR-0019](../adr/0019-server-runtime-contract.md)
- [ADR-0023](../adr/0023-compliance-observability.md)

## When to use what — decision tree

```text
Flat-rate subscriptions only                  → payments.md (skip this)
Per-API-call / per-GB / per-token             → this recipe
Per-seat (active users)                        → this recipe (treat seat as a unit)
"You used 80% of your quota" alerts            → this recipe + service-limits.md
Tax-jurisdiction rules                         → Stripe Tax / Avalara (out of scope here)
Refunds for billing errors                     → this recipe (correction flow)
Real-time pay-as-you-go (per-second)           → this recipe + sub-second aggregation
```

## Architecture — the four-stage pipeline

```text
1. EMIT             2. PERSIST           3. AGGREGATE         4. REPORT
                                                              
src/.../+server.ts  usage_events table   usage_aggregates     stripe.subscriptionItems
recordUsage(...)    (raw, partitioned)   (per period)         .createUsageRecord(...)
   │                       │                    │                    │
   │ event_id              │ append-only        │ window worker      │ idempotent
   │ tenant_id             │ idempotent         │ runs every 5min    │ key=usage_aggregate.id
   │ unit, qty             │ on event_id        │ deduplicates       │
   │ ts (server)           │                    │                    │
   ▼                       ▼                    ▼                    ▼
```

Stages are **decoupled by the database** — emit is fast (single
insert), persist is durable, aggregate is batched, report is
recoverable. A single failure in any stage doesn't lose data; it
delays it.

## Shape — bounded Zod contracts

```ts
// packages/billing/src/schema.ts
import { z } from 'zod';

export const Unit = z.enum([
  'api_calls',
  'storage_gb_hour',
  'ai_tokens',
  'seats_active',
  'minutes_streamed',
  'webhooks_delivered',
]);
export type Unit = z.infer<typeof Unit>;

export const UsageEvent = z.object({
  id: z.string().uuid(), // UUIDv7 for time-ordered idempotency
  tenantId: z.string().uuid(),
  unit: Unit,
  quantity: z.number().nonnegative().finite(),
  occurredAt: z.string().datetime(),
  // Source path / route / span id — for forensic correction
  source: z.string().min(1).max(200),
  // Idempotency: requester-supplied; same key = same event
  idempotencyKey: z.string().min(8).max(200),
});
export type UsageEvent = z.infer<typeof UsageEvent>;

export const AggregationWindow = z.enum(['minute', 'hour', 'day', 'period']);
export type AggregationWindow = z.infer<typeof AggregationWindow>;

export const UsageAggregate = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  unit: Unit,
  window: AggregationWindow,
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
  quantity: z.number().nonnegative(),
  eventCount: z.number().int().nonnegative(),
  // Reporting state — null until pushed to Stripe
  stripeReportedAt: z.string().datetime().nullable(),
  stripeUsageRecordId: z.string().nullable(),
  // Correction lineage
  correctedFrom: z.string().uuid().nullable().default(null),
});
export type UsageAggregate = z.infer<typeof UsageAggregate>;

export const PlanMeter = z.object({
  unit: Unit,
  stripePriceId: z.string().regex(/^price_/),
  included: z.number().nonnegative(),       // free allotment per period
  overage: z.object({
    perUnitCents: z.number().int().nonnegative(),
    softAlertAt: z.number().min(0).max(1).default(0.8),
    hardLimit: z.number().nonnegative().nullable().default(null),
  }),
});
export type PlanMeter = z.infer<typeof PlanMeter>;
```

UUIDv7 for `id` gives time-ordered keys (cheap b-tree inserts) and
embeds the timestamp — useful for partition pruning + forensic work.

## Reference — emit endpoint

```ts
// packages/billing/src/record.ts
import { uuidv7 } from 'uuidv7';
import { UsageEvent, type Unit } from './schema';
import { db } from '$lib/server/db';

export async function recordUsage(input: {
  tenantId: string;
  unit: Unit;
  quantity: number;
  source: string;
  idempotencyKey: string;
  occurredAt?: Date;
}) {
  const event = UsageEvent.parse({
    id: uuidv7(),
    tenantId: input.tenantId,
    unit: input.unit,
    quantity: input.quantity,
    occurredAt: (input.occurredAt ?? new Date()).toISOString(),
    source: input.source,
    idempotencyKey: input.idempotencyKey,
  });

  // Idempotency on (tenant_id, idempotency_key) — DO NOTHING on conflict.
  // Concurrent retries land here harmlessly.
  await db.query(
    `INSERT INTO usage_events (id, tenant_id, unit, quantity, occurred_at, source, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tenant_id, idempotency_key) DO NOTHING`,
    [event.id, event.tenantId, event.unit, event.quantity, event.occurredAt, event.source, event.idempotencyKey],
  );
}
```

```sql
-- migrations/0042_usage_events.sql
CREATE TABLE usage_events (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  unit            TEXT NOT NULL,
  quantity        NUMERIC(20, 6) NOT NULL CHECK (quantity >= 0),
  occurred_at     TIMESTAMPTZ NOT NULL,
  source          TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, idempotency_key)
) PARTITION BY RANGE (occurred_at);

CREATE INDEX idx_usage_events_tenant_unit_time
  ON usage_events (tenant_id, unit, occurred_at);

-- Partition per day for cheap retention drops + bulk prune.
CREATE TABLE usage_events_2026_04_18 PARTITION OF usage_events
  FOR VALUES FROM ('2026-04-18') TO ('2026-04-19');
```

## Reference — aggregation worker (5-minute windows)

```ts
// packages/billing/src/aggregator.ts
import { uuidv7 } from 'uuidv7';
import { Unit } from './schema';
import { db } from '$lib/server/db';
import { auditLog } from '$lib/server/audit';

// Run every 5 min by cron-jobs.md
export async function aggregateUsage(now = new Date()) {
  const windowEnd = floorTo5Min(now);
  const windowStart = new Date(windowEnd.getTime() - 5 * 60_000);

  // Skip current window — events arriving in the next minute would
  // produce a partial aggregate; defer until window is "closed" + 60s safety.
  if (windowEnd > new Date(now.getTime() - 60_000)) return;

  await db.transaction(async (tx) => {
    // Compute aggregates for every (tenant, unit) with events in this window.
    const rows = await tx.query<{ tenant_id: string; unit: Unit; total: string; count: string }>(
      `SELECT tenant_id, unit, SUM(quantity) AS total, COUNT(*) AS count
       FROM usage_events
       WHERE occurred_at >= $1 AND occurred_at < $2
       GROUP BY tenant_id, unit`,
      [windowStart.toISOString(), windowEnd.toISOString()],
    );

    for (const r of rows.rows) {
      // Idempotent on (tenant, unit, window_start, window) — re-running
      // the worker for the same window is a no-op.
      await tx.query(
        `INSERT INTO usage_aggregates
           (id, tenant_id, unit, window, window_start, window_end, quantity, event_count)
         VALUES ($1, $2, $3, 'minute', $4, $5, $6, $7)
         ON CONFLICT (tenant_id, unit, window, window_start) DO NOTHING`,
        [uuidv7(), r.tenant_id, r.unit, windowStart.toISOString(), windowEnd.toISOString(),
         Number(r.total), Number(r.count)],
      );
    }
  });

  await auditLog('billing.aggregate.completed', {
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    rows: 'see DB',
  });
}

function floorTo5Min(d: Date): Date {
  const ms = 5 * 60_000;
  return new Date(Math.floor(d.getTime() / ms) * ms);
}
```

## Reference — Stripe reporter

```ts
// packages/billing/src/reporter.ts
import Stripe from 'stripe';
import { db } from '$lib/server/db';
import { auditLog } from '$lib/server/audit';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-12-18.acacia' });

// Run every 5 min by cron-jobs.md
export async function reportUsageToStripe() {
  // Pull aggregates not yet reported. LIMIT to bound batch size.
  const { rows } = await db.query<{
    id: string;
    tenant_id: string;
    unit: string;
    quantity: string;
    window_end: string;
  }>(
    `SELECT id, tenant_id, unit, quantity, window_end
     FROM usage_aggregates
     WHERE stripe_reported_at IS NULL
     ORDER BY window_end ASC
     LIMIT 500`,
  );

  for (const r of rows) {
    const subItem = await getStripeSubscriptionItem(r.tenant_id, r.unit);
    if (!subItem) continue; // tenant has no Stripe sub for this unit

    try {
      const usage = await stripe.subscriptionItems.createUsageRecord(
        subItem.id,
        {
          quantity: Math.round(Number(r.quantity)), // Stripe needs integer
          timestamp: Math.floor(new Date(r.window_end).getTime() / 1000),
          action: 'increment',
        },
        // Idempotency-Key per aggregate id — Stripe dedupes, so retries safe.
        { idempotencyKey: `usage-record-${r.id}` },
      );

      await db.query(
        `UPDATE usage_aggregates
         SET stripe_reported_at = NOW(), stripe_usage_record_id = $1
         WHERE id = $2`,
        [usage.id, r.id],
      );
    } catch (e) {
      // 4xx (other than 429) = config error → audit + skip;
      // 429 / 5xx / network = leave unreported, retry next run.
      if (e instanceof Stripe.errors.StripeInvalidRequestError) {
        await auditLog('billing.report.failed', { aggregateId: r.id, error: e.message });
      } else {
        // Transient — let next run retry.
      }
    }
  }
}

async function getStripeSubscriptionItem(tenantId: string, unit: string) {
  // Cached lookup of (tenant, unit) → stripe_subscription_item_id
  // Maintained via Stripe webhook (customer.subscription.updated).
  return db.queryOne(
    `SELECT id, stripe_item_id AS id FROM tenant_meters WHERE tenant_id = $1 AND unit = $2`,
    [tenantId, unit],
  );
}
```

`Idempotency-Key: usage-record-${aggregate.id}` — Stripe deduplicates
within a 24h window per
`stripe.com/docs/api/idempotent_requests`. Re-running the reporter
for the same aggregate produces zero double-charges.

## Overage alerts — proactive customer notification

```ts
// packages/billing/src/alerts.ts
import { PLAN_ENTITLEMENTS } from '@sveltesentio/tenant';
import { Unit } from './schema';
import { db } from '$lib/server/db';
import { sendNotification } from '@sveltesentio/notifications';

// Run hourly
export async function checkOverages(periodStart: Date, periodEnd: Date) {
  const tenants = await db.query<{ tenant_id: string; plan: string }>(
    `SELECT id AS tenant_id, plan FROM tenants WHERE status = 'active'`,
  );

  for (const t of tenants.rows) {
    const meters = PLAN_ENTITLEMENTS[t.plan].meters;

    for (const meter of meters) {
      const used = await db.queryOne<{ total: string }>(
        `SELECT COALESCE(SUM(quantity), 0) AS total
         FROM usage_aggregates
         WHERE tenant_id = $1 AND unit = $2
           AND window_start >= $3 AND window_end <= $4`,
        [t.tenant_id, meter.unit, periodStart.toISOString(), periodEnd.toISOString()],
      );

      const ratio = Number(used.total) / meter.included;
      if (ratio >= meter.overage.softAlertAt) {
        await sendNotification({
          tenantId: t.tenant_id,
          type: 'usage.overage_warning',
          dedupeKey: `usage-warn:${t.tenant_id}:${meter.unit}:${periodStart.toISOString()}`,
          meta: { unit: meter.unit, used: Number(used.total), included: meter.included, ratio },
        });
      }
      if (meter.overage.hardLimit && Number(used.total) >= meter.overage.hardLimit) {
        await db.query(
          `UPDATE tenants SET status = 'usage_blocked' WHERE id = $1`,
          [t.tenant_id],
        );
        await sendNotification({
          tenantId: t.tenant_id,
          type: 'usage.hard_limit_hit',
          dedupeKey: `usage-block:${t.tenant_id}:${meter.unit}:${periodStart.toISOString()}`,
          meta: { unit: meter.unit, used: Number(used.total), hardLimit: meter.overage.hardLimit },
        });
      }
    }
  }
}
```

`dedupeKey` includes period — alert fires once per overage event,
not on every hourly check. Per
[notifications-center.md](notifications-center.md) the dispatcher
suppresses duplicates.

## Retroactive correction — fixing a metering bug

You discover that for 3 days you double-counted `api_calls`. Three
correction strategies:

1. **Refund customer** (Stripe credit note) — simplest, cleanest from
   customer's perspective; complex if invoice already paid.
2. **Negative usage record** — Stripe accepts `quantity: -N` to
   subtract from a usage period. Requires window not yet invoiced.
3. **Full re-aggregation** — replay raw events with corrected logic;
   diff old vs new aggregate; emit delta usage record.

```ts
// packages/billing/src/correct.ts
export async function correctAggregate(aggregateId: string, newQuantity: number) {
  const old = await db.queryOne<{ tenant_id: string; unit: string; quantity: string; stripe_usage_record_id: string | null }>(
    `SELECT tenant_id, unit, quantity, stripe_usage_record_id FROM usage_aggregates WHERE id = $1`,
    [aggregateId],
  );
  const delta = newQuantity - Number(old.quantity);
  if (delta === 0) return;

  const correctionId = uuidv7();

  await db.transaction(async (tx) => {
    // Insert correction aggregate row (lineage: correctedFrom = old.id)
    await tx.query(
      `INSERT INTO usage_aggregates (id, tenant_id, unit, window, window_start, window_end, quantity, event_count, corrected_from)
       SELECT $1, tenant_id, unit, window, window_start, window_end, $2, 0, id
       FROM usage_aggregates WHERE id = $3`,
      [correctionId, delta, aggregateId],
    );

    await auditLog('billing.correction', {
      originalAggregateId: aggregateId,
      correctionAggregateId: correctionId,
      delta,
      reason: 'metering bug 2026-04-18',
    });
  });

  // Reporter picks up the new (delta) aggregate and pushes to Stripe.
}
```

Every correction is an **append**, not an update — original aggregate
is preserved for audit. The correction has its own Stripe usage
record, idempotent on its own ID.

## Anti-patterns (25)

1. **Reporting raw events directly to Stripe** — Stripe rate-limits
   usage records (~25 req/s); high-volume APIs blow through. Always
   aggregate first.
2. **No idempotency key on `recordUsage`** — duplicate webhook +
   retry = double-billed customer.
3. **No idempotency on Stripe `createUsageRecord`** — worker retry
   after 500 = duplicate usage record = duplicate billing.
4. **Aggregating the *current* window** — events still arriving;
   partial aggregate gets reported; later events lost.
5. **Aggregating per-event in the request path** — adds DB latency
   to every API call; high-volume tenants hit lock contention.
6. **`UPDATE ... SET quantity = quantity + ?`** — race condition
   under concurrent requests. Insert append-only events; aggregate
   later.
7. **Not partitioning `usage_events`** — table grows unbounded;
   queries slow; retention drops require expensive `DELETE`.
8. **Soft-limit alert without dedupe key** — customer gets 24
   identical "you're at 80%" emails per day.
9. **Hard-limit kicks in only at next billing period** — customer
   blasts past quota for hours. Enforce in real-time per
   [service-limits.md](service-limits.md).
10. **No `correctedFrom` lineage** — finance can't reconstruct what
    the original aggregate said before correction; audit fails.
11. **Mutating reported aggregates** — once reported to Stripe, the
    aggregate is immutable. Use a correction (delta) aggregate
    instead.
12. **Floating-point quantities** — `0.1 + 0.2 = 0.30000000000004`
    in the database. Use `NUMERIC(20, 6)` in Postgres + bigint cents
    where possible.
13. **`Math.round()` before storage** — loses precision for
    sub-unit metering (per-millisecond, per-byte). Round only at
    Stripe-report time.
14. **Reporting in tenant local time** — period boundaries shift per
    tenant; aggregation logic explodes. Always UTC; convert in UI.
15. **Per-tenant cron schedules** — N tenants × cron = N jobs.
    One worker handling all tenants per period is enough.
16. **No backpressure on emit endpoint** — bursty tenant takes down
    `usage_events` table. Per-tenant rate limit + bulk insert.
17. **Aggregation worker overlapping itself** — long aggregation
    window from previous run still going; new run starts and
    duplicates work. Use a Postgres advisory lock or BullMQ
    `concurrency: 1`.
18. **No retention policy on `usage_events`** — table grows forever
    even after aggregates exist. Drop partitions older than 90 days.
19. **Webhook from Stripe (e.g., subscription updated) not updating
    cached `tenant_meters`** — reporter pushes to wrong subscription
    item; charges land on cancelled plan.
20. **Missing `tenant_meters` row** — silent drop. Audit-log each
    skipped report so finance can investigate.
21. **`createUsageRecord` `action: 'set'` instead of `'increment'`** —
    `set` overwrites the period total to the value; if you report
    `100` then later `50`, customer is charged for `50`. Always
    `increment` with deltas.
22. **No reconciliation job** — drift between local aggregates and
    Stripe invoice goes undetected. Daily reconciliation + alert on
    mismatch >1%.
23. **Charging in advance vs arrears confusion** — Stripe usage
    records bill in arrears at period end. Don't display "charged
    now" UI; show "will be billed at period end".
24. **Showing usage in customer UI but not the billed amount** —
    customers expect to see their pending bill grow in real-time.
    Surface it.
25. **No "free trial overage" toggle** — trial users hit hard limits
    and abandon onboarding. Give trials soft-limits-only;
    convert to hard at first paid period.

## References

- ADRs: [0019](../adr/0019-server-runtime-contract.md),
  [0023](../adr/0023-compliance-observability.md)
- Sibling recipes:
  [payments.md](payments.md),
  [tenant-provisioning.md](tenant-provisioning.md),
  [service-limits.md](service-limits.md),
  [notifications-center.md](notifications-center.md),
  [audit-log.md](audit-log.md),
  [queue-workers.md](queue-workers.md),
  [cron-jobs.md](cron-jobs.md),
  [observability.md](observability.md)
- Upstream:
  Stripe Usage Records `stripe.com/docs/billing/subscriptions/metered-billing`,
  Stripe Idempotency `stripe.com/docs/api/idempotent_requests`,
  PostgreSQL Partitioning
  `www.postgresql.org/docs/current/ddl-partitioning.html`,
  UUIDv7 spec `datatracker.ietf.org/doc/html/rfc9562#name-uuid-version-7`.
