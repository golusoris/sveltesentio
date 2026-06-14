# Service limits — quota enforcement beyond rate-limiting with soft + hard thresholds

Rate-limiting ([rate-limiting.md](rate-limiting.md)) is per-request
per-time-window; service limits are per-tenant per-billing-period for
consumable resources. A user might be under 100 req/min but over their
plan's 10 GB storage quota — different enforcement, different UX,
different failure mode. This recipe codifies the contract for
**storage / compute / per-seat / API-calls / AI-tokens** quotas with
**soft thresholds (warn, notify) + hard thresholds (block, degrade)**,
plan-aware Zod-typed `QuotaPolicy`, idempotent usage counters, and
billing-portal integration.

Per [principles.md §2.1](../principles.md) (Power of 10 — exhaustive
error handling at boundaries) and [principles.md §2.2](../principles.md)
(OWASP ASVS L2 V4 — access control enforced server-side), the default
posture is: **quotas checked server-side in the `load`/`+server.ts`
before mutation**, **soft threshold 80% sends email + in-app banner**,
**hard threshold 100% returns RFC 9457 `urn:sveltesentio:quota:exceeded`
with `retryAfter`/`upgradeUrl` fields**, never silent-throttle or
degrade-without-telling-user.

## Related

- [rate-limiting.md](rate-limiting.md) — per-request per-second;
  service-limits is per-tenant per-month. Don't conflate.
- [payments.md](payments.md) — quota-exceeded CTA links to Billing
  Portal upgrade flow; plan changes update `QuotaPolicy` via webhook.
- [permissions.md](permissions.md) — quota check is a permission
  check in spirit; same `load` gate pattern, different data source.
- [feature-flags.md](feature-flags.md) — overriding quota for
  specific tenants (enterprise trials) goes through OpenFeature
  targeting, not a column in the `tenants` table.
- [audit-log.md](audit-log.md) — every soft-threshold crossing +
  every hard-threshold block writes an audit event for compliance
  + customer-success visibility.
- [observability.md](observability.md) — `quota.resource` bounded
  label, `quota.usage_pct` gauge per tenant (low-cardinality via
  bucket binning, not raw percentage).
- [cron-jobs.md](cron-jobs.md) — `quota-recompute` daily cron
  reconciles counters against source-of-truth (DB aggregates,
  object store metadata).
- [webhooks.md](webhooks.md) — Stripe `customer.subscription.updated`
  webhook triggers `QuotaPolicy` refresh.
- [server-state.md](server-state.md) — client-side quota-remaining
  UI reads via TanStack Query; never computes locally.
- [toast.md](toast.md) — hard-threshold block surfaces via toast
  + modal-with-upgrade-CTA; soft-threshold via dismissible banner.
- [principles.md §2.1](../principles.md) — Power of 10.
- [principles.md §2.2](../principles.md) — OWASP ASVS L2 V4.

## Rate-limit vs service-limit — the distinction

```text
Dimension                       Rate-limit               Service-limit
──────────────────────────────────────────────────────────────────────
Window                          seconds / minute         billing period (month)
Per-subject                     IP / userId              tenantId
Carrier                         Redis token bucket       Postgres usage_counters
Exceeded response status        429                      402 (Payment Required) or 403
Exceeded response type-URI      urn:…:rate-exceeded      urn:…:quota-exceeded
Retry                           seconds                  upgrade plan / wait until reset
User control                    none (wait it out)       upgrade button
UI surface                      toast + Retry-After      banner + billing-portal link
Typical attack shape            DoS / scraping           abuse via free-tier stacking
Refund on error                 never refund             DO refund on 5xx (consumed ≠ delivered)
```

**Three separation rules:**

1. **Don't reuse the rate-limit bucket for quotas.** Redis TTL
   semantics don't match monthly billing cycles. Use Postgres +
   explicit reset windows.
2. **Quota-exceeded is not retryable in seconds.** Don't send
   `Retry-After: 60`. Send `upgradeUrl` + "quota resets on
   YYYY-MM-DD".
3. **Rate-limit is anonymous-safe; quota-limit requires a tenant.**
   Anonymous traffic never consumes quota (no one to bill). If you
   find yourself quota-gating anonymous traffic, you want
   rate-limiting instead.

## When to reach for what

```text
Per-request scraping defense                → rate-limiting.md
Per-month storage cap (GB)                  → service-limits.md (hard)
Per-month API calls (plan-scaled)           → service-limits.md (soft+hard)
Per-month AI tokens / images / minutes      → service-limits.md (soft+hard)
Per-seat user count (team plan)             → service-limits.md (hard, at add-user)
Per-day send limit (emails)                 → service-limits.md (rolling 24h)
Concurrent-operations cap (e.g. 5 jobs)     → service-limits.md (gauge-not-counter)
Per-user per-day something                  → rate-limiting.md (bucket with day-TTL)
```

## Install

No package — this is DB + Zod + `+server.ts` composition.

## Shape

```text
src/lib/quota/
├── policy.ts             QuotaPolicy Zod schema + plan → policy resolver
├── counters.ts           incrementUsage / getUsage / resetUsage DB helpers
├── enforce.ts            enforceQuota() gate for load / POST handlers
├── thresholds.ts         soft-threshold (80%) + hard-threshold (100%) emission
└── schemas.ts            QuotaResource enum + QuotaErrorDetail

src/routes/api/billing/
├── quota/+server.ts      GET — current tenant usage + remaining
└── upgrade-url/+server.ts GET — signed Stripe billing-portal URL

supabase/migrations/NNN_usage_counters.sql
                          usage_counters table (tenant_id, resource, period, count)
```

## Reference pattern

### 1. `QuotaResource` and `QuotaPolicy`

```typescript
// src/lib/quota/schemas.ts
import { z } from 'zod';

export const QuotaResource = z.enum([
  'storage_bytes',
  'api_calls',
  'ai_tokens',
  'ai_images',
  'seats',
  'projects',
  'webhooks_per_hour',
]);
export type QuotaResource = z.infer<typeof QuotaResource>;

export const QuotaWindow = z.enum(['period', 'rolling_day', 'rolling_hour', 'instant']);

export const QuotaLimit = z.object({
  resource: QuotaResource,
  limit: z.number().int().nonnegative(),
  window: QuotaWindow,
  softPct: z.number().min(0).max(100).default(80),
  overage: z.enum(['block', 'meter', 'degrade']).default('block'),
});
export type QuotaLimit = z.infer<typeof QuotaLimit>;

export const QuotaPolicy = z.object({
  planId: z.string(),
  limits: z.array(QuotaLimit),
});
export type QuotaPolicy = z.infer<typeof QuotaPolicy>;
```

**Five schema rules:**

1. **`QuotaResource` is a bounded enum.** New resource = enum bump +
   ADR (if cross-cutting) or scoped PR. Free-form strings sprawl
   into `storage`, `storage_gb`, `storageBytes`, and billing then
   can't sum them.
2. **`window`-aware semantics.** `period` = billing-month;
   `rolling_day` = last 24h sliding; `instant` = concurrent-gauge
   (seats in use right now). One schema, three DB shapes; enforce
   per window.
3. **`softPct: 80` default, overridable per limit.** Some resources
   (`seats`) have no soft — you're at 4/5 or 5/5 and the warning
   matters at the hard threshold.
4. **`overage`: `block` | `meter` | `degrade`.** `block` is the
   default safest; `meter` (charge for overage) requires Stripe
   usage-based price configured; `degrade` (reduce quality, e.g. AI
   fallback to smaller model) is explicit fallback behavior.
5. **Plan → policy resolution is pure.** `resolvePolicy(plan)` is a
   map lookup, no IO. Policies ship in code, not the DB — they're
   part of the product, not customer-editable.

### 2. Usage counters (Postgres)

```sql
CREATE TABLE usage_counters (
  tenant_id   UUID NOT NULL,
  resource    TEXT NOT NULL,
  period_key  TEXT NOT NULL,
  count       BIGINT NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, resource, period_key),
  CONSTRAINT usage_counters_resource_len CHECK (length(resource) <= 64),
  CONSTRAINT usage_counters_period_len CHECK (length(period_key) <= 32)
);

CREATE INDEX usage_counters_period_idx ON usage_counters (period_key, resource);
```

```typescript
// src/lib/quota/counters.ts
import { db } from '$lib/db';
import { now } from '$lib/clock';
import type { QuotaResource, QuotaWindow } from './schemas';

export function periodKey(window: QuotaWindow, at: Date = now()): string {
  if (window === 'period') return at.toISOString().slice(0, 7); // YYYY-MM
  if (window === 'rolling_day') return at.toISOString().slice(0, 10); // YYYY-MM-DD
  if (window === 'rolling_hour') return at.toISOString().slice(0, 13); // YYYY-MM-DDTHH
  return 'instant';
}

export async function incrementUsage(
  tenantId: string,
  resource: QuotaResource,
  delta: number,
  window: QuotaWindow,
): Promise<number> {
  const key = periodKey(window);
  const row = await db.one<{ count: string }>(
    `INSERT INTO usage_counters (tenant_id, resource, period_key, count)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, resource, period_key)
       DO UPDATE SET count = usage_counters.count + EXCLUDED.count,
                     updated_at = now()
     RETURNING count`,
    [tenantId, resource, key, delta],
  );
  return Number(row.count);
}

export async function getUsage(
  tenantId: string,
  resource: QuotaResource,
  window: QuotaWindow,
): Promise<number> {
  const key = periodKey(window);
  const row = await db.oneOrNone<{ count: string }>(
    `SELECT count FROM usage_counters
      WHERE tenant_id = $1 AND resource = $2 AND period_key = $3`,
    [tenantId, resource, key],
  );
  return row ? Number(row.count) : 0;
}
```

**Five counter rules:**

1. **`(tenant_id, resource, period_key)` PK** — every increment is
   a single-row upsert; no contention on a monotonic counter across
   tenants.
2. **`period_key` as derived string** — `2026-04` for period,
   `2026-04-18` for rolling_day. Rotating periods is just picking a
   new key; old rows age out via cron.
3. **Increment is atomic.** `INSERT … ON CONFLICT … DO UPDATE … SET
   count = count + delta RETURNING count` gives you the post-
   increment value in one roundtrip. Never `SELECT` then `UPDATE`
   in separate transactions — race condition.
4. **`BIGINT` not `INTEGER`.** `storage_bytes` blows past 2^31
   (2.1 GB) trivially. AI-token counters can reach millions/day
   per tenant.
5. **Instant-gauge (seats-in-use) doesn't use counters.** Those are
   computed: `SELECT count(*) FROM memberships WHERE tenant_id = $1`.
   Don't maintain a parallel counter that drifts.

### 3. `enforceQuota()` — the gate

```typescript
// src/lib/quota/enforce.ts
import { error } from '@sveltejs/kit';
import { resolvePolicy } from './policy';
import { getUsage, incrementUsage } from './counters';
import { emitSoftCrossed } from './thresholds';
import type { QuotaResource } from './schemas';

export interface QuotaErrorDetail {
  type: 'urn:sveltesentio:quota:exceeded';
  title: 'Quota exceeded';
  status: 402;
  resource: QuotaResource;
  used: number;
  limit: number;
  resetAt: string;
  upgradeUrl: string;
  overage: 'block' | 'meter' | 'degrade';
}

export async function enforceQuota(
  tenantId: string,
  planId: string,
  resource: QuotaResource,
  delta: number,
): Promise<{ used: number; limit: number; remaining: number }> {
  const policy = resolvePolicy(planId);
  const limit = policy.limits.find((l) => l.resource === resource);

  if (!limit) {
    throw error(500, {
      type: 'urn:sveltesentio:quota:misconfigured',
      title: 'Quota not configured',
      status: 500,
      resource,
    });
  }

  const current = await getUsage(tenantId, resource, limit.window);
  const projected = current + delta;

  if (projected > limit.limit && limit.overage === 'block') {
    throw error(402, {
      type: 'urn:sveltesentio:quota:exceeded',
      title: 'Quota exceeded',
      status: 402,
      resource,
      used: current,
      limit: limit.limit,
      resetAt: resetDateFor(limit.window).toISOString(),
      upgradeUrl: `/billing/upgrade?from=${planId}&resource=${resource}`,
      overage: 'block',
    } satisfies QuotaErrorDetail);
  }

  const next = await incrementUsage(tenantId, resource, delta, limit.window);

  if (current < (limit.limit * limit.softPct) / 100 &&
      next >= (limit.limit * limit.softPct) / 100) {
    void emitSoftCrossed({ tenantId, resource, used: next, limit: limit.limit });
  }

  return { used: next, limit: limit.limit, remaining: Math.max(0, limit.limit - next) };
}
```

**Six enforcement rules:**

1. **Check-then-increment in the same function.** The check is
   informational only; the atomic increment is the authoritative
   gate. If two concurrent calls both read 99/100 and both try to
   increment, one ends at 100, one at 101 — the post-increment
   read sees 101 and you either rollback (hard) or meter (soft).
2. **`402 Payment Required` for block.** HTTP statuses have
   semantic weight — 402 specifically signals "pay to continue,"
   exactly matching the UX. 429 means "wait and try again" and is
   wrong.
3. **RFC 9457 envelope with `resource` / `used` / `limit` /
   `resetAt` / `upgradeUrl` / `overage`.** The client switches on
   `type`, reads the rest. Never stuff these into the `detail`
   free-text field — they're structured data.
4. **`upgradeUrl` is internal-route, not Stripe URL.** Stripe URLs
   expire; our `/billing/upgrade` route constructs a fresh portal
   session on click.
5. **Soft-crossing emits exactly once** per period via
   `current < threshold && next >= threshold`. Idempotent because
   the second crossing (112/100) only fires once: the first 100→101
   increment tripped it; subsequent increments are post-threshold.
6. **`resetDateFor(window)`** is deterministic from the `period_key`
   — end-of-month for `period`, 24h from first-hit for
   `rolling_day`. Use UTC, match cron-jobs-utc-discipline.

### 4. Enforcement in `+server.ts` and `+page.server.ts`

```typescript
// src/routes/api/projects/+server.ts
import type { RequestHandler } from './$types';
import { superValidate } from 'sveltekit-superforms/server';
import { zod } from 'sveltekit-superforms/adapters';
import { CreateProjectSchema } from './schemas';
import { enforceQuota } from '$lib/quota/enforce';

export const POST: RequestHandler = async ({ request, locals }) => {
  const form = await superValidate(request, zod(CreateProjectSchema));
  if (!form.valid) return new Response(JSON.stringify(form), { status: 400 });

  await enforceQuota(locals.session.tenantId, locals.session.planId, 'projects', 1);

  const project = await createProject(locals.session.tenantId, form.data);

  return new Response(JSON.stringify(project), { status: 201 });
};
```

**Four enforcement-placement rules:**

1. **Enforce *before* mutation.** `enforceQuota` throws on hard-
   block *before* the DB insert. Otherwise you orphan rows then
   can't bill for them.
2. **For storage-bytes, enforce *after* upload with refund-on-fail.**
   You can't know byte count before upload; increment by actual
   size post-persist, and if post-increment exceeds limit, delete
   the object and return 402. [uploads.md](uploads.md) pattern.
3. **For `meter` overage, never block — record overage.** The
   billing period's invoice will include the overage; your check
   is an audit+metric emission, not a hard gate.
4. **For `degrade` overage, route at the feature.** E.g.
   ai-tokens over-quota → switch model from `claude-opus` to
   `claude-haiku`. The gate is *in* the AI handler, not at
   `+server.ts` boundary.

## Refund semantics — the usage-on-error trap

```typescript
try {
  await enforceQuota(tenantId, planId, 'ai_tokens', estimated);
  const result = await callAI(prompt);
  const actual = result.tokensUsed;
  if (actual !== estimated) {
    await incrementUsage(tenantId, 'ai_tokens', actual - estimated, 'period');
  }
  return result;
} catch (err) {
  await incrementUsage(tenantId, 'ai_tokens', -estimated, 'period');
  throw err;
}
```

**Five refund rules:**

1. **Consume on entry, reconcile on exit.** Pessimistic accounting
   — if you estimate 1000 tokens, reserve 1000; if the call uses
   800, refund 200; if it fails, refund all 1000.
2. **Never refund on 4xx-user-error.** User-sent malformed prompt
   → they used the tokens' worth of compute. Refund on 5xx
   (server error, upstream outage) only.
3. **Refund is `incrementUsage(-N)`, not delete.** The counter is
   signed-by-convention; the atomic upsert handles negative
   deltas fine.
4. **Audit both directions.** Every consume and every refund
   writes an audit row with `delta` signed — billing dispute
   resolution needs the ledger.
5. **Refund is idempotent via error correlation-id.** If the same
   request is retried and both attempts fail, you refund twice
   unless the refund is keyed on the `correlationId`. Use a
   `usage_events` ledger table if you need strong accounting, not
   just a counter.

## Soft threshold UX

```svelte
<!-- src/lib/components/QuotaBanner.svelte -->
<script lang="ts">
  import type { QuotaUsage } from '$lib/quota/schemas';

  let { usage }: { usage: QuotaUsage } = $props();
  const pct = $derived((usage.used / usage.limit) * 100);
  const stage = $derived(
    pct >= 100 ? 'exceeded' : pct >= 95 ? 'critical' : pct >= 80 ? 'warning' : 'ok',
  );
</script>

{#if stage !== 'ok'}
  <div role="status" aria-live="polite" class="quota-banner quota-banner--{stage}">
    <strong>
      {#if stage === 'exceeded'}
        You've reached your {usage.resource} limit.
      {:else if stage === 'critical'}
        You've used {pct.toFixed(0)}% of your {usage.resource} quota.
      {:else}
        {usage.used} / {usage.limit} {usage.resource} used this period.
      {/if}
    </strong>
    <a href="/billing/upgrade">Upgrade plan</a>
  </div>
{/if}
```

**Five UX rules:**

1. **`role="status"` not `role="alert"`.** Quota warnings are
   informational; `alert` interrupts screen readers and wins the
   focus queue for minor information.
2. **Three stages: 80% warning / 95% critical / 100% exceeded.**
   One banner component renders all three; the 100% stage is
   typically accompanied by a blocking modal on the action that
   triggered it.
3. **CTA is always "Upgrade plan"** — linked to
   `/billing/upgrade?resource=X`. Never dead-ends "contact
   support" for self-serve plans.
4. **Reset date visible on exceeded state** — "resets on
   April 30" so users know blocking is time-limited, not
   permanent.
5. **Dismiss-then-remind cadence.** Soft-dismiss hides for 24h,
   then re-appears. Don't suppress for the full period.

## Observability — bounded label set

```text
Attribute              Values
────────────────────────────────────────────────────────
quota.resource         QuotaResource enum (bounded)
quota.action           'check' | 'increment' | 'refund' | 'reset'
quota.outcome          'allowed' | 'blocked' | 'metered' | 'degraded'
quota.usage_bucket     '<50' | '50-80' | '80-95' | '95-100' | '>100'

Metrics
────────────────────────────────────────────────────────
quota.enforcement.count          counter, labels: resource, outcome
quota.soft_threshold.crossed     counter, labels: resource
quota.hard_threshold.blocked     counter, labels: resource
quota.refund.count               counter, labels: resource, reason
```

**Four observability rules:**

1. **`quota.usage_bucket` is a bucketed string**, not a raw
   percentage. Raw `pct` → 10k distinct values per tenant =
   cardinality explosion. Five buckets is enough for trends.
2. **`tenantId` is a span attribute, never a metric label.**
   Alerts read `hard_threshold.blocked > threshold` aggregated;
   the per-tenant drill-down is via span search.
3. **Dashboard panels: usage-over-time per-resource + top-10
   tenants-approaching-limit.** Customer success pings those
   tenants before they get blocked.
4. **Alerts on soft-crossings-per-hour**, not hard-blocks. A
   plan-tier that's generating 100 soft-crosses/hour is likely
   miscalibrated.

## Reconciliation — daily cron

```typescript
// src/routes/api/cron/quota-recompute/+server.ts
import { withCronRun } from '../_shared/runner';
import { verifyCronRequest } from '../_shared/authn';
import { recomputeStorageUsage } from '$lib/quota/reconcile';

export const POST: RequestHandler = async ({ request }) => {
  verifyCronRequest(request);

  return withCronRun('quota-recompute', async () => {
    let processed = 0;
    for await (const tenantId of streamTenants()) {
      await recomputeStorageUsage(tenantId);
      processed++;
    }
    return { processed, skipped: 0 };
  });
};
```

**Four reconciliation rules:**

1. **Source-of-truth reconcile for accounting-critical resources.**
   Storage-bytes counter drifts (uploads that failed mid-persist,
   manual DB ops). Daily cron sums actual from object-store
   metadata, overwrites counter — via `cron-jobs.md`.
2. **Don't reconcile API-call counters.** API-call counts are
   fire-and-forget; drift is small and reconciliation would
   require full request logs (which you shouldn't retain for
   billing purposes per GDPR).
3. **Log drift before overwriting.** `counter.drift_pct` metric
   > 5% is an alert — indicates a leak (bug in increment path) or
   reconciliation bug.
4. **Reconciliation is additive-only by default.** Prefer
   `UPDATE … SET count = GREATEST(count, $new)` so a slow
   reconciliation doesn't undo in-flight increments from the
   previous few seconds.

## Billing-portal integration

```typescript
// src/routes/billing/upgrade/+server.ts
import { stripe } from '$lib/payments/stripe';

export const GET: RequestHandler = async ({ url, locals }) => {
  const session = await stripe.billingPortal.sessions.create({
    customer: locals.session.stripeCustomerId,
    return_url: `${url.origin}/app?upgraded=1`,
    flow_data: {
      type: 'subscription_update',
      subscription_update: { subscription: locals.session.stripeSubscriptionId },
    },
  });

  throw redirect(303, session.url);
};
```

**Three billing-integration rules:**

1. **`customer.subscription.updated` webhook refreshes
   `QuotaPolicy`.** Never poll; never re-resolve at request-time
   from Stripe — cache plan → policy at the `tenants` row,
   update on webhook.
2. **Plan-downgrade mid-period doesn't reset counters.** A tenant
   who downgrades from plan-A (100 GB) to plan-B (10 GB) while
   at 50 GB used is instantly-over-quota; the UX surfaces this
   pre-downgrade at the billing-portal confirm step (Stripe does
   this for proration; you must do it for quotas).
3. **Trial expiry → tenant remains on plan but usage-frozen**,
   not deleted. Payment retry flow picks up automatically; data
   stays intact; quotas become read-only until resolved.

## Testing — three lanes

```typescript
it('blocks mutation at hard threshold with 402', async () => {
  seedUsage(tenant, 'projects', 9);
  seedPolicy(tenant, { projects: 10 });

  const res = await app.request('/api/projects', postBody(validProject));
  expect(res.status).toBe(201);

  const res2 = await app.request('/api/projects', postBody(validProject));
  expect(res2.status).toBe(402);
  const body = await res2.json();
  expect(body.type).toBe('urn:sveltesentio:quota:exceeded');
});

it('increments and refunds atomically', async () => {
  seedUsage(tenant, 'ai_tokens', 0);
  mockAI({ fail: true });

  await expect(callAIEndpoint({ estimated: 1000 })).rejects.toThrow();
  const usage = await getUsage(tenant, 'ai_tokens', 'period');
  expect(usage).toBe(0);
});

it('emits soft-crossing exactly once per threshold', async () => {
  const spy = vi.fn();
  subscribeAudit(spy);
  seedUsage(tenant, 'api_calls', 79);
  seedPolicy(tenant, { api_calls: { limit: 100, softPct: 80 } });

  await enforceQuota(tenant, 'plan', 'api_calls', 1); // 80 -- crosses
  await enforceQuota(tenant, 'plan', 'api_calls', 1); // 81 -- no crossing
  await enforceQuota(tenant, 'plan', 'api_calls', 1); // 82 -- no crossing

  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy).toHaveBeenCalledWith(expect.objectContaining({ action: 'quota.soft_crossed' }));
});
```

**Three test rules:**

1. **Concurrent-increment race-condition test.** Fire 10 parallel
   requests when usage is at 95/100; assert exactly 5 succeed and
   5 return 402. This is the one quota bug that escapes to prod.
2. **Period-boundary test.** Use injected clock to roll from
   `2026-04` to `2026-05`, assert counter resets to 0 at the new
   `period_key`.
3. **Refund-on-5xx test** separate from refund-on-4xx (which
   shouldn't refund). The distinction is a common bug.

## Anti-patterns

1. **Reusing the rate-limit bucket for quotas.** Redis TTL
   semantics don't match monthly cycles; the bucket drifts, resets
   at wrong times, and billing complaints follow.
2. **Checking quota in the client.** A motivated user bypasses
   every client check. Server-side only, at the mutation boundary.
3. **Silent degrade without user notification.** Dropping AI
   quality or disabling features with no banner = churn via
   confusion. Always-tell-the-user, even on `degrade` overage.
4. **Hard-blocking with 429.** Reserves a semantic that means
   "retry in seconds." Use 402 for payment-required; 403 if you
   genuinely just won't serve them regardless.
5. **Counter-increment outside a transaction** with the mutation
   it gates. Mutation succeeds but counter didn't increment →
   free-tier abuse. Wrap both in a tx (or use the same connection
   and handle rollback carefully).
6. **`SELECT count THEN UPDATE count+1`.** Classic race. Use
   `INSERT … ON CONFLICT DO UPDATE SET count = count + EXCLUDED.count
   RETURNING count`.
7. **Free-form resource strings.** `"storage"` vs `"storage_bytes"`
   vs `"diskUsage"` — bounded enum, no exceptions.
8. **No refund on failed-work.** Charging users for calls that
   5xx'd is a support nightmare and legally questionable for
   billed plans. Refund on 5xx, never on 4xx.
9. **Quota limits in the DB as per-tenant overrides.** Plan →
   policy is code; per-tenant overrides are a feature-flag
   targeted rule, not a `tenants.quota_override_json` column that
   becomes impossible to audit.
10. **No visibility into "which tenants are near limit?"** — the
    customer success flow depends on it. Daily digest of
    `>80%` tenants with upcoming reset-date.
11. **Instant-gauge tracked as counter.** `seats_in_use` isn't a
    counter that increments on add and decrements on remove — it's
    a `SELECT count(*)`. Counters drift when a direct-DB cleanup
    happens.
12. **No audit trail on hard-blocks.** Customer claims "I wasn't
    warned" — and you have no evidence of the soft-threshold
    crossing or the hard-block. Every threshold event → audit row.
13. **Quota-exceeded error with no `upgradeUrl`.** Dead-end UX;
    support ticket volume spikes. The CTA is the whole point.
14. **Unbounded `ai_tokens` in the free tier.** Zero rate-limit +
    zero quota = your OpenAI bill is the user's attack surface.
    Always both — rate-limiting caps burst, quota caps total.
15. **Resetting counters on plan-change without confirm.** User
    upgrades mid-period; resetting their usage gives them a
    "free" reset they can exploit. Prorate instead — usage
    continues, limit scales up.
16. **No cron reconciliation for storage-bytes.** The counter is
    the source-of-truth only until it drifts; object-store
    aggregate is the real source. Daily reconcile keeps them
    aligned.

## References

- [ADR-0019 — structured errors](../adr/0019-structured-errors.md) —
  `urn:sveltesentio:quota:exceeded` envelope.
- [ADR-0023 — observability](../adr/0023-observability.md) — bounded
  `quota.resource` label, drift metric.
- [rate-limiting.md](rate-limiting.md) — sibling per-request gate.
- [payments.md](payments.md) — Stripe plan → policy mapping.
- [cron-jobs.md](cron-jobs.md) — `quota-recompute` reconciliation.
- [audit-log.md](audit-log.md) — threshold-crossing audit events.
- [observability.md](observability.md) — bounded attributes + drift
  alerts.
- [uploads.md](uploads.md) — storage-bytes enforce-after-upload.
- [RFC 7231 §6.5.2 — 402 Payment Required](https://datatracker.ietf.org/doc/html/rfc7231#section-6.5.2) — status semantics.
- [RFC 9457 — Problem Details for HTTP APIs](https://datatracker.ietf.org/doc/html/rfc9457) — error envelope.
- [Stripe Billing — usage-based pricing](https://stripe.com/docs/billing/subscriptions/usage-based) — meter overage integration.
- [PostgreSQL `ON CONFLICT`](https://www.postgresql.org/docs/current/sql-insert.html#SQL-ON-CONFLICT) — atomic upsert semantics.
