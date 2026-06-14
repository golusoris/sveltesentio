# pricing-plans-changes.md — composition recipe

> **Plan-change pipeline for sveltesentio:** upgrade / downgrade /
> cancel mid-cycle, Stripe `subscription.update` with the right
> `proration_behavior`, **grandfathered legacy plans**, **trial-to-paid
> conversion**, **dunning** (smart retries + email cadence),
> **prorated invoice preview** in-UI before commit, and the customer-
> facing **plan-change comms**. Per
> [ADR-0019](../adr/0019-server-state-discipline.md) every plan
> mutation flows through one server endpoint with Idempotency-Key,
> RFC 9457 ProblemError envelope, and a webhook-driven reconciliation
> that **never** trusts the client to declare a change applied.

This recipe covers the *change-flow* on top of
[payments.md](payments.md) (Stripe Elements/Checkout setup) and
[billing-usage-metering.md](billing-usage-metering.md) (usage-based
metering). All three together describe the full revenue surface.

## Related

- [payments.md](payments.md) — Stripe Elements + webhook reconciliation
  base layer; this recipe sits on top
- [billing-usage-metering.md](billing-usage-metering.md) — metered
  components (overage rolls into proration calculations)
- [tenant-provisioning.md](tenant-provisioning.md) — initial
  subscription creation; this recipe covers everything after
- [account-deletion.md](account-deletion.md) — cancellation + data
  retention contract
- [feature-flag-rollout-patterns.md](feature-flag-rollout-patterns.md) —
  plan-gated feature flags surface the new plan immediately
- [permissions.md](permissions.md) + [rbac-modeling.md](rbac-modeling.md) —
  plan-derived permissions (`plan:pro:export-csv`)
- [audit-log.md](audit-log.md) — every plan change is an audit event
- [observability.md](observability.md) — plan-change events feed MRR
  metrics
- [structured-emails.md](structured-emails.md) — receipts + dunning
  emails travel through this template channel
- [error-boundaries.md](error-boundaries.md) — `card_declined` surfaces
  via ProblemError envelope
- [ADR-0019](../adr/0019-server-state-discipline.md) — Idempotency-Key
  + RFC 9457
- [ADR-0023](../adr/0023-observability-uuidv7.md) — UUIDv7 + audit log

## When to use what

```text
First-time sub creation                    → tenant-provisioning.md
Card swap on existing sub                  → payments.md (Stripe Customer Portal)
Quantity change on per-seat plan           → this recipe (Reference §1)
Tier change (Free → Pro, Pro → Enterprise) → this recipe (Reference §2)
Cancel at period end (default)             → this recipe (Reference §3)
Cancel immediately + refund                → this recipe (Reference §3)
Pause subscription                         → this recipe (Reference §4)
Trial extension                            → this recipe (Reference §5)
Grandfathered legacy plan migration        → this recipe (Reference §6)
Failed-payment recovery                    → this recipe (Reference §7 — dunning)
Coupon / discount apply                    → this recipe (Reference §8)
```

## Proration decision tree (the one decision that breaks teams)

```text
Customer goes from $50/mo → $200/mo on day 10 of 30-day cycle
                                                       │
        ┌──────────────────────────────────────────────┼──────────────────────────────────────────────┐
        │                                              │                                              │
   create_prorations                              none                                       always_invoice
   (default)                                      (pre-paid only)                            (one-off invoice)
        │                                              │                                              │
   Credit unused $33 (20/30 of $50)                Charge new $200 from next cycle              Charge prorated diff
   Charge prorated $133 (20/30 of $200)            (customer keeps old plan to period end)      ($100) immediately
   on next invoice                                                                              (subscription unchanged)
   Net invoice: +$100
```

- **`create_prorations` is the right default.** Predictable, fair,
  matches what most SaaS customers expect.
- **`none` is for grandfathered cohorts** that pre-paid annually and
  upgrade — don't double-charge them; honor the period.
- **`always_invoice` is for accounting-strict tenants** (Enterprise)
  who want a separate invoice per change for reconciliation.

The choice **must** be explicit in code; never default to whatever
Stripe last shipped.

## Install

```bash
pnpm add -F @sveltesentio/billing stripe zod
# Stripe SDK because plan changes are Stripe API calls.
# No bespoke wrapper — see ADR-0019 streamlining rule.
```

> **Server-only.** `stripe` SDK never imports into client bundles.
> Webhook secret + secret key live behind `$env/static/private`. See
> [secrets-management.md](secrets-management.md).

## Shape — bounded Zod for every change

```ts
// packages/billing/src/plan-change.ts
import { z } from 'zod';

export const PlanTier = z.enum(['free', 'starter', 'pro', 'enterprise']);
export type PlanTier = z.infer<typeof PlanTier>;

export const ProrationBehavior = z.enum([
  'create_prorations',
  'none',
  'always_invoice',
]);

export const ChangePlanInput = z.object({
  // Idempotency from caller (UI button click) — matches RFC 9457 contract.
  idempotencyKey: z.string().uuid(),
  targetTier: PlanTier,
  // Per-seat quantity (1 for non-seat plans).
  quantity: z.number().int().min(1).max(10000),
  // Proration choice — explicit, never default.
  prorationBehavior: ProrationBehavior,
  // Effective date — `null` means "right now". `'period_end'` defers.
  effective: z.union([z.literal('now'), z.literal('period_end')]),
  // Optional coupon to apply at the same time.
  couponId: z.string().min(1).max(64).nullable(),
});
export type ChangePlanInput = z.infer<typeof ChangePlanInput>;

export const PreviewInput = ChangePlanInput.omit({ idempotencyKey: true });

export const ChangePreview = z.object({
  immediateChargeCents: z.number().int(),
  // Negative = credit; positive = charge.
  nextInvoiceCents: z.number().int(),
  effectiveAt: z.string().datetime(),
  lineItems: z.array(z.object({
    description: z.string(),
    amountCents: z.number().int(),
    period: z.object({ start: z.string().datetime(), end: z.string().datetime() }),
  })).max(20),
  currency: z.enum(['usd', 'eur', 'gbp']),
});

export const CancelInput = z.object({
  idempotencyKey: z.string().uuid(),
  when: z.enum(['period_end', 'immediately']),
  reason: z.enum([
    'too_expensive',
    'missing_features',
    'switched_competitor',
    'business_closed',
    'other',
  ]),
  feedback: z.string().max(2000).optional(),
});
```

Reasons enum is a fixed set so we can compute churn-by-reason without
free-text parsing. `feedback` is optional.

## Reference patterns

### 1. Quantity change (per-seat)

```ts
// src/routes/api/billing/seats/+server.ts
import { json } from '@sveltejs/kit';
import { stripe } from '$lib/server/stripe';
import { db } from '$lib/server/db';
import { ChangePlanInput } from '@sveltesentio/billing';
import { recordAudit } from '$lib/server/audit';

export async function POST({ request, locals }) {
  const parsed = ChangePlanInput.pick({ idempotencyKey: true, quantity: true, prorationBehavior: true })
    .safeParse(await request.json());
  if (!parsed.success) {
    return json({ type: 'about:blank', title: 'Invalid', status: 422 }, { status: 422 });
  }

  const tenant = await db.query(
    `SELECT stripe_subscription_id, stripe_subscription_item_id FROM tenants WHERE id = $1`,
    [locals.tenant.id],
  ).then(r => r.rows[0]);

  // Stripe accepts our idempotency key — *and* we record it so a retry
  // returns the same applied state.
  const updated = await stripe.subscriptions.update(
    tenant.stripe_subscription_id,
    {
      items: [{
        id: tenant.stripe_subscription_item_id,
        quantity: parsed.data.quantity,
      }],
      proration_behavior: parsed.data.prorationBehavior,
    },
    { idempotencyKey: parsed.data.idempotencyKey },
  );

  await recordAudit({
    tenantId: locals.tenant.id,
    actor: locals.user.id,
    action: 'billing.seats.changed',
    payload: { newQuantity: parsed.data.quantity, prorationBehavior: parsed.data.prorationBehavior, stripeSubscriptionId: updated.id },
  });

  return json({ ok: true, status: updated.status });
}
```

The reconciled state lives in the **webhook** (`customer.subscription.updated`),
not in this response. The response only confirms that Stripe accepted the
mutation. Don't copy `quantity` into your DB from here — wait for the
webhook to write it.

### 2. Tier change with preview

```ts
// src/routes/api/billing/preview/+server.ts
import { json } from '@sveltejs/kit';
import { stripe } from '$lib/server/stripe';
import { db } from '$lib/server/db';
import { PreviewInput, ChangePreview } from '@sveltesentio/billing';
import { tierToPriceId } from '$lib/server/billing/catalog';

export async function POST({ request, locals }) {
  const parsed = PreviewInput.safeParse(await request.json());
  if (!parsed.success) {
    return json({ type: 'about:blank', title: 'Invalid', status: 422 }, { status: 422 });
  }

  const tenant = await db.query(
    `SELECT stripe_customer_id, stripe_subscription_id, stripe_subscription_item_id FROM tenants WHERE id = $1`,
    [locals.tenant.id],
  ).then(r => r.rows[0]);

  const upcoming = await stripe.invoices.retrieveUpcoming({
    customer: tenant.stripe_customer_id,
    subscription: tenant.stripe_subscription_id,
    subscription_items: [{
      id: tenant.stripe_subscription_item_id,
      price: tierToPriceId(parsed.data.targetTier),
      quantity: parsed.data.quantity,
    }],
    subscription_proration_behavior: parsed.data.prorationBehavior,
    coupon: parsed.data.couponId ?? undefined,
  });

  const preview = ChangePreview.parse({
    immediateChargeCents: upcoming.amount_due,
    nextInvoiceCents: upcoming.total,
    effectiveAt: new Date(upcoming.period_end * 1000).toISOString(),
    lineItems: upcoming.lines.data.slice(0, 20).map(l => ({
      description: l.description ?? '',
      amountCents: l.amount,
      period: {
        start: new Date(l.period.start * 1000).toISOString(),
        end: new Date(l.period.end * 1000).toISOString(),
      },
    })),
    currency: upcoming.currency as 'usd' | 'eur' | 'gbp',
  });

  return json(preview);
}
```

Show the preview to the customer **before** the commit button is
active. "You will be charged $123.45 today, and $200.00 on May 15"
prevents 80% of refund tickets.

### 3. Cancellation (default = period end)

```ts
export async function POST({ request, locals }) {
  const parsed = CancelInput.safeParse(await request.json());
  if (!parsed.success) {
    return json({ type: 'about:blank', title: 'Invalid', status: 422 }, { status: 422 });
  }

  const tenant = /* ... */;

  if (parsed.data.when === 'period_end') {
    // Default: customer keeps access until period ends.
    await stripe.subscriptions.update(
      tenant.stripe_subscription_id,
      { cancel_at_period_end: true, cancellation_details: { comment: parsed.data.feedback?.slice(0, 500), feedback: parsed.data.reason } },
      { idempotencyKey: parsed.data.idempotencyKey },
    );
  } else {
    // Immediate cancel + prorated refund of unused time.
    await stripe.subscriptions.cancel(
      tenant.stripe_subscription_id,
      { prorate: true, invoice_now: true },
      { idempotencyKey: parsed.data.idempotencyKey },
    );
  }

  await recordAudit({
    tenantId: locals.tenant.id,
    actor: locals.user.id,
    action: 'billing.subscription.cancelled',
    payload: { when: parsed.data.when, reason: parsed.data.reason },
  });

  // Revoking access happens in the webhook (customer.subscription.deleted), not here.
  return json({ ok: true });
}
```

Default `when: 'period_end'` reduces refund-request volume to near
zero. Always offer "cancel now" too — taking it away feels predatory.

### 4. Pause (Stripe `pause_collection`)

```ts
await stripe.subscriptions.update(tenant.stripe_subscription_id, {
  pause_collection: {
    behavior: 'mark_uncollectible', // 'keep_as_draft' | 'mark_uncollectible' | 'void'
    resumes_at: Math.floor(resumeDate.getTime() / 1000),
  },
}, { idempotencyKey });
```

Use `mark_uncollectible` for "you won't be charged but please come back"
seasonal pauses. Use `void` to write off accrued invoices.

### 5. Trial extension

```ts
await stripe.subscriptions.update(tenant.stripe_subscription_id, {
  trial_end: Math.floor(newTrialEnd.getTime() / 1000),
  proration_behavior: 'none', // trials don't prorate
}, { idempotencyKey });
```

Per Stripe docs `trial_end` extension can only push the trial forward;
shortening it requires `trial_end: 'now'` followed by a normal
plan-change.

### 6. Grandfathering — keep old prices live

```ts
// src/lib/server/billing/catalog.ts
export const PRICE_CATALOG = {
  // current
  starter: 'price_2026_starter_monthly',
  pro: 'price_2026_pro_monthly',
  enterprise: 'price_2026_enterprise_monthly',
  // grandfathered (still sold to existing tenants on these price ids)
  starter_2024: 'price_2024_starter_monthly',
  pro_2024: 'price_2024_pro_monthly',
} as const;

export function tierToPriceId(tier: PlanTier, tenantSignupYear?: number): string {
  if (tenantSignupYear && tenantSignupYear < 2026 && (tier === 'starter' || tier === 'pro')) {
    return PRICE_CATALOG[`${tier}_2024` as keyof typeof PRICE_CATALOG];
  }
  return PRICE_CATALOG[tier];
}
```

Rules of grandfathering:

- **Never delete a Stripe price**. Archive it
  (`price.update({ active: false })`) so existing subs continue but
  new subs cannot be created against it.
- **Map signup-year → price** in code, not in customer metadata.
  Customer metadata is mutable; the catalog is the law.
- **Document the cutover date in comments** beside each grandfathered
  price id so the next engineer doesn't think it's dead code.

### 7. Dunning (failed-payment recovery)

Stripe's Smart Retries handle the *attempts*; we own the *comms*:

```ts
// src/routes/api/webhooks/stripe/+server.ts (excerpt)
case 'invoice.payment_failed': {
  const invoice = event.data.object;
  const tenant = await db.query(`SELECT id, contact_email FROM tenants WHERE stripe_customer_id = $1`, [invoice.customer]).then(r => r.rows[0]);
  const attemptCount = invoice.attempt_count;

  if (attemptCount === 1) {
    await sendEmail('dunning-attempt-1', tenant.contact_email, { invoiceUrl: invoice.hosted_invoice_url });
  } else if (attemptCount === 2) {
    await sendEmail('dunning-attempt-2', tenant.contact_email, { invoiceUrl: invoice.hosted_invoice_url });
  } else if (attemptCount >= 3) {
    await sendEmail('dunning-final', tenant.contact_email, { invoiceUrl: invoice.hosted_invoice_url });
    // Soft-disable feature gates after final notice.
    await db.query(`UPDATE tenants SET billing_status = 'past_due' WHERE id = $1`, [tenant.id]);
  }
  break;
}

case 'customer.subscription.deleted': {
  // Stripe finally gave up after Smart Retries exhaust. Hard-disable.
  await db.query(`UPDATE tenants SET billing_status = 'cancelled', cancelled_at = NOW() WHERE stripe_customer_id = $1`, [event.data.object.customer]);
  break;
}
```

Dunning email cadence (each template lives in
[structured-emails.md](structured-emails.md)):

```text
Day 0    invoice.payment_failed (attempt 1) → friendly "card was declined"
Day 3    invoice.payment_failed (attempt 2) → action-needed
Day 7    invoice.payment_failed (attempt 3) → final notice + soft-disable
Day 10   customer.subscription.deleted     → cancellation confirmation
```

Map exactly to Stripe's default Smart Retries schedule so the email
always arrives the day Stripe actually retried.

### 8. Coupons + discounts

```ts
// Apply at change-time
await stripe.subscriptions.update(tenant.stripe_subscription_id, {
  coupon: 'BLACKFRIDAY2026', // or `discounts: [{ coupon: '...' }]`
}, { idempotencyKey });

// Remove a coupon
await stripe.subscriptions.update(tenant.stripe_subscription_id, {
  coupon: '', // empty string = remove
}, { idempotencyKey });
```

Coupon governance:

- **Whitelist coupon ids in code.** Don't accept arbitrary coupon codes
  from the URL — that's a $0-checkout vector.
- **One coupon per subscription.** Stacking causes accounting confusion.
- **Document expiry + usage cap on creation in Stripe Dashboard** — the
  catalog code is one source, Stripe is the other; these must match.

## Plan-derived permissions (one place)

```ts
// src/lib/server/billing/plan-permissions.ts
import type { PlanTier } from '@sveltesentio/billing';

export const PLAN_FEATURES: Record<PlanTier, ReadonlyArray<string>> = {
  free:       ['view-dashboard'],
  starter:    ['view-dashboard', 'export-csv', 'invite-up-to-3'],
  pro:        ['view-dashboard', 'export-csv', 'invite-up-to-50', 'sso', 'audit-log-90d'],
  enterprise: ['view-dashboard', 'export-csv', 'invite-unlimited', 'sso', 'audit-log-1y', 'sla', 'dedicated-support'],
};

export function planAllows(plan: PlanTier, feature: string): boolean {
  return PLAN_FEATURES[plan].includes(feature);
}
```

Wire `planAllows` into `authorize()` from
[rbac-modeling.md](rbac-modeling.md). The plan-change webhook updates
the tenant's plan, which flips features on the next request — no
deploy needed, no cache to invalidate beyond TanStack Query's normal
revalidation.

## Customer comms (every plan event)

| Event | Template | Subject |
|---|---|---|
| Upgrade applied | `plan-upgraded.mjml` | "You're on Pro — welcome" |
| Downgrade scheduled | `plan-downgrade-scheduled.mjml` | "Your plan changes on May 15" |
| Cancel scheduled | `cancel-scheduled.mjml` | "We'll miss you — your access ends May 15" |
| Cancel immediate | `cancel-immediate.mjml` | "Your subscription is cancelled" |
| Trial ending in 3d | `trial-ending.mjml` | "3 days left in your trial" |
| Card expiring | `card-expiring.mjml` | "Update your card before May 31" |
| Payment failed | `dunning-attempt-1.mjml` | "We couldn't process your payment" |
| Final notice | `dunning-final.mjml` | "Last chance to update your card" |
| Refund issued | `refund-issued.mjml` | "Your refund is on its way" |

All templates live in [structured-emails.md](structured-emails.md);
plain-text alternates mandatory.

## Anti-patterns

- **Trusting the client to declare a plan applied.** The button click
  is *intent*; the `customer.subscription.updated` webhook is *truth*.
  Update the DB only from the webhook handler.
- **Calling `subscription.update` without an `idempotencyKey`.** Double-
  click on the upgrade button = double charge. Always pass a UUIDv7
  generated client-side and sent in the request body.
- **Defaulting `proration_behavior` to whatever Stripe ships.** Be
  explicit per call. If you don't say `create_prorations`, Stripe may
  change the default and refund tickets follow.
- **Deleting a Stripe price for a discontinued plan.** Existing
  subscribers' next invoice fails. Archive (`active: false`) instead.
- **Storing the plan tier in the JWT.** Plan changes mid-session leave
  the JWT stale until expiry. Read plan from `locals.tenant` derived
  fresh per request — see [permissions.md](permissions.md).
- **Letting "downgrade now" be the default cancel UI.** Default to
  "cancel at period end" — the customer paid for it, give it to them.
- **Skipping the proration preview.** Surprise charges are the #1 SaaS
  refund driver. Always show `immediateChargeCents` before the commit.
- **Hard-disabling features the moment a payment fails.** Smart Retries
  recover ~30% of failed payments in 7 days. Soft-disable on retry 3,
  hard-disable on Stripe-deleted-subscription only.
- **Different dunning cadence in code vs Stripe Dashboard config.**
  They drift; emails arrive on days when nothing happened. Pin one
  source of truth (Dashboard schedule) and mirror in code.
- **Free-text cancel reasons only.** Without an enum you cannot compute
  churn-by-reason. Enum first, optional `feedback` second.
- **Cancelling immediately by default after the customer clicks
  "cancel".** Always confirm + show the period-end vs immediately
  choice with consequences spelled out.
- **Promising a refund in the cancel-confirmation email when the
  refund is conditional on bank-side processing.** "Refund is on its
  way to your card and may take 5–10 business days" — never "Your
  card has been refunded" before Stripe confirms.
- **Coupon code accepted from URL query parameter without whitelist.**
  `?coupon=FREE100` becomes a $0 checkout. Whitelist server-side.
- **Stacking coupons.** Accounting gets confused; refund math breaks.
  Enforce one coupon per subscription.
- **Allowing trial extension without rate-limit.** A bad actor extends
  trials indefinitely. Cap to N extensions per tenant lifetime.
- **Plan-derived permissions in three places.** Pick one — `PLAN_FEATURES`
  table — and enforce via `planAllows()`. Multiple sources guarantee
  drift.
- **Webhook handler that throws on unrecognized event type.** Stripe
  sends new event types over time; log + 200, don't 500.
- **Webhook signature check with `req.body` after JSON parsing.** Must
  use raw body bytes; parsed JSON re-stringification breaks the HMAC.
  See [payments.md](payments.md).
- **Reading customer locale from Stripe.** Stripe doesn't store
  reliable locale; use the tenant's locale from your own DB.
- **Storing card numbers / CVCs anywhere.** PCI-DSS violation. Stripe
  Elements + tokenization is non-negotiable. See [payments.md](payments.md).
- **Allowing self-serve enterprise downgrade.** Enterprise contracts
  often have multi-year minimums. Gate enterprise downgrades behind
  manual CSM review.
- **Showing the proration preview in the customer's local currency
  but charging in USD.** Surface charge currency (`currency` field)
  in the preview UI explicitly.
- **No audit log entry for plan changes.** Auditors and customers both
  need a paper trail. See [audit-log.md](audit-log.md).
- **Missing tenant comms for the "downgrade scheduled" state.** The
  customer clicked downgrade today; the change applies in 20 days.
  Without an email at click-time + a reminder at T-3 days they will
  forget and complain when features disappear.
- **Forgetting to revoke seats when quantity drops.** Stripe doesn't
  pick which users to deactivate — your code does, in the
  `customer.subscription.updated` webhook handler.

## References

- ADRs: [0019](../adr/0019-server-state-discipline.md),
  [0023](../adr/0023-observability-uuidv7.md),
  [0035](../adr/0035-permissions-and-rbac.md)
- Sibling recipes: [payments.md](payments.md),
  [billing-usage-metering.md](billing-usage-metering.md),
  [tenant-provisioning.md](tenant-provisioning.md),
  [account-deletion.md](account-deletion.md),
  [feature-flag-rollout-patterns.md](feature-flag-rollout-patterns.md),
  [permissions.md](permissions.md),
  [rbac-modeling.md](rbac-modeling.md),
  [audit-log.md](audit-log.md),
  [structured-emails.md](structured-emails.md),
  [error-boundaries.md](error-boundaries.md)
- External: Stripe `subscription.update` API reference; Stripe Smart
  Retries docs; Stripe Customer Portal (offload card swaps); Stripe
  cancellation API; ProfitWell churn-reduction research; Patrick
  McKenzie "SaaS pricing" essays; PCI-DSS v4.0 §3 (cardholder data
  protection)
