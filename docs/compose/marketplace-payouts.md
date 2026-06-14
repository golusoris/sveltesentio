# marketplace-payouts.md — composition recipe

> **Revenue share for third-party apps + developer payouts.**
> Complements [oauth-app-marketplace.md](oauth-app-marketplace.md)
> (which covers the install-flow side); this recipe covers **the
> money**: how revenue is attributed to installed apps, how the
> platform's cut is computed, how developers get paid, and how
> reporting satisfies **DAC7 (EU)** and **1099-K (US)** platform-
> operator obligations. Per
> [ADR-0019](../adr/0019-http-client-and-error-model.md) the
> platform is a **seller-of-record** (buyer pays platform; platform
> pays developer) using Stripe Connect; per
> [ADR-0023](../adr/0023-compliance-audit-log-contract.md) every
> payout, hold, reversal, and tax filing is audit-logged.

> **The three legal roles that determine everything.** (1) **Seller-
> of-record** — platform collects, platform is liable for tax, uses
> Connect Standard or Custom. (2) **Facilitator-only** — sellers
> collect; platform reports but doesn't handle money (DAC7 regime).
> (3) **Marketplace with platform fees** — sellers collect via
> Connect Express; platform takes application_fee. Pick once; it
> cascades through every decision.

## Related

- [oauth-app-marketplace.md](oauth-app-marketplace.md) — install/uninstall
  flow; app metadata; scopes
- [payments.md](payments.md) — Stripe PaymentIntents are the base
- [billing-tax.md](billing-tax.md) — buyer-side tax handled there;
  developer-side income reporting handled here
- [pricing-plans-changes.md](pricing-plans-changes.md) — plan-change
  prorations can trigger payout clawbacks
- [audit-log.md](audit-log.md) — every payout event
- [webhooks-outbound.md](webhooks-outbound.md) — developer-facing
  payout webhooks (`payout.paid`, `payout.held`)
- [content-moderation.md](content-moderation.md) — payouts gated on
  app status; disapproved apps are held
- [rbac-modeling.md](rbac-modeling.md) — `payouts:admin` + `tax:admin`
- [gdpr-data-export.md](gdpr-data-export.md) — tax forms are part of
  developer data export
- [ADR-0019](../adr/0019-http-client-and-error-model.md),
  [ADR-0023](../adr/0023-compliance-audit-log-contract.md)

## When to use what

```text
Platform sells, developer gets share           → Stripe Connect Custom (this recipe)
                                                 Platform is seller-of-record
Developer sells directly                        → Stripe Connect Express or Standard
                                                 Facilitator model; platform charges fee only
Physical-goods marketplace                      → Outside scope (Amazon-style, 1099-K applies)
Services marketplace (Upwork-style)             → This recipe + escrow pattern
Content creator tips / donations                → Stripe Connect Express + Subscription
                                                 DAC7 if ≥€2k+30 txns/yr
Enterprise app deals (6-figure)                 → Manual invoicing out of flow
                                                 Payout on contract, not Stripe
Affiliate fees to referrers (not developers)    → referral-program.md, not here
Internal revenue-share between your own apps    → Accounting ledger, not Connect
```

## The money flow

```text
Buyer pays $100                          (Stripe checkout)
  └─ $100 captured to platform account   (buyer sees "Your Company" on statement)
     └─ Application fee: $30 (30%)       (platform's revenue)
     └─ Transfer to developer: $70       (net of buyer-side refunds + holds)

At payout time (default: daily):
     └─ Developer's Connect balance → developer's bank
     └─ Stripe pays out per connected-account schedule

Reporting:
  - Monthly: developer 1099-K gross (US, $600+) or DAC7 (EU, €2k+30txn)
  - Annual:  year-end filing
```

## Shape — bounded Zod

```ts
// packages/marketplace/src/payouts/types.ts
import { z } from 'zod';

export const PayoutStatus = z.enum([
  'pending',       // accumulating balance
  'scheduled',     // scheduled for next payout cycle
  'in_transit',    // bank is processing
  'paid',          // landed
  'failed',        // bank rejected; retry or flag for review
  'held',          // manual hold (fraud review, moderation action)
  'reversed',      // buyer refund pulled the money back
]);
export type PayoutStatus = z.infer<typeof PayoutStatus>;

export const RevenueShare = z.object({
  // For (appId, effectiveFrom) — append-only; rates change over time.
  appId: z.string().uuid(),
  developerAccountId: z.string().uuid(),
  platformPercent: z.number().min(0).max(100),        // e.g. 30 for "platform takes 30%"
  minimumCentsPerSale: z.number().int().min(0),       // Stripe + processor fee floor
  effectiveFrom: z.string().datetime({ offset: true }),
  effectiveUntil: z.string().datetime({ offset: true }).nullable(),
});
export type RevenueShare = z.infer<typeof RevenueShare>;

export const Sale = z.object({
  id: z.string().uuid(),                               // UUIDv7
  appId: z.string().uuid(),
  installationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  buyerCustomerId: z.string().min(1),                  // Stripe customer id
  paymentIntentId: z.string().min(1),
  grossMinor: z.number().int().min(0),
  platformCutMinor: z.number().int().min(0),
  developerNetMinor: z.number().int().min(0),
  currency: z.string().regex(/^[a-z]{3}$/),
  shareRateId: z.string().uuid(),                      // link to RevenueShare row used
  occurredAt: z.string().datetime({ offset: true }),
  refundedMinor: z.number().int().min(0).default(0),
  chargebackMinor: z.number().int().min(0).default(0),
});
export type Sale = z.infer<typeof Sale>;

export const Payout = z.object({
  id: z.string().uuid(),
  developerAccountId: z.string().uuid(),
  stripeTransferId: z.string().nullable(),             // stripe `tr_...`
  stripePayoutId: z.string().nullable(),               // stripe `po_...`
  periodStart: z.string().datetime({ offset: true }),
  periodEnd: z.string().datetime({ offset: true }),
  grossMinor: z.number().int().min(0),
  refundsMinor: z.number().int().min(0),
  chargebacksMinor: z.number().int().min(0),
  holdsMinor: z.number().int().min(0),
  taxWithholdingMinor: z.number().int().min(0),
  netPaidMinor: z.number().int().min(0),
  currency: z.string().regex(/^[a-z]{3}$/),
  status: PayoutStatus,
  saleIds: z.array(z.string().uuid()).min(1).max(10_000),
  createdAt: z.string().datetime({ offset: true }),
  paidAt: z.string().datetime({ offset: true }).nullable(),
  failureReason: z.string().max(500).nullable(),
});
export type Payout = z.infer<typeof Payout>;
```

## Reference pattern

### 1. Developer onboarding — Stripe Connect Custom

```ts
// packages/marketplace/src/payouts/onboard.ts
import Stripe from 'stripe';
const stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2024-11-20.acacia' });

export async function startConnectOnboarding(developerAccountId: string, returnUrl: string) {
  const developer = await loadDeveloper(developerAccountId);

  // Create Connect account if not exists.
  let acct = developer.stripeConnectAccountId
    ? await stripe.accounts.retrieve(developer.stripeConnectAccountId)
    : await stripe.accounts.create({
        type: 'custom',
        country: developer.country,
        email: developer.email,
        capabilities: { transfers: { requested: true } },
        business_type: developer.isIndividual ? 'individual' : 'company',
        metadata: { developerAccountId },
      });

  if (!developer.stripeConnectAccountId) {
    await updateDeveloperStripeAccount(developerAccountId, acct.id);
  }

  // Create an Account Link for the developer to complete KYC.
  const link = await stripe.accountLinks.create({
    account: acct.id,
    refresh_url: returnUrl,
    return_url: returnUrl,
    type: 'account_onboarding',
  });
  return link.url;
}
```

**KYC is non-negotiable.** Stripe Connect gates payouts on
identity-verified accounts. For US: SSN/EIN + address + DOB. For
EU: equivalent under local KYC regimes. We never see the raw
documents — Stripe's hosted onboarding collects them.

### 2. Sale recording — charge + application_fee

```ts
// packages/marketplace/src/payouts/charge.ts
export async function createMarketplaceCharge(input: {
  appId: string;
  installationId: string;
  tenantId: string;
  buyerCustomerId: string;
  grossMinor: number;
  currency: string;
  description: string;
}): Promise<Sale> {
  const app = await loadApp(input.appId);
  const share = await currentRevenueShare(input.appId);
  const dev = await loadDeveloper(share.developerAccountId);
  if (!dev.stripeConnectAccountId) throw new Error('developer_not_onboarded');
  if (app.status !== 'listed') throw new Error('app_not_listed');

  const platformCut = Math.floor((input.grossMinor * share.platformPercent) / 100)
    + share.minimumCentsPerSale;
  const developerNet = input.grossMinor - platformCut;
  if (developerNet < 0) throw new Error('negative_developer_net');

  const pi = await stripe.paymentIntents.create({
    amount: input.grossMinor,
    currency: input.currency,
    customer: input.buyerCustomerId,
    application_fee_amount: platformCut,
    transfer_data: { destination: dev.stripeConnectAccountId },
    metadata: { appId: input.appId, installationId: input.installationId, tenantId: input.tenantId },
    description: input.description,
  }, { idempotencyKey: `sale:${input.installationId}:${input.description}` });

  const sale = await insertSale({
    id: crypto.randomUUID(),
    appId: input.appId,
    installationId: input.installationId,
    tenantId: input.tenantId,
    buyerCustomerId: input.buyerCustomerId,
    paymentIntentId: pi.id,
    grossMinor: input.grossMinor,
    platformCutMinor: platformCut,
    developerNetMinor: developerNet,
    currency: input.currency.toLowerCase(),
    shareRateId: share.id,
    occurredAt: new Date().toISOString(),
    refundedMinor: 0,
    chargebackMinor: 0,
  });
  await writeAuditEvent({ kind: 'marketplace.sale.recorded', subjectId: share.developerAccountId, payload: { saleId: sale.id, grossMinor: input.grossMinor, platformCutMinor: platformCut } });
  return sale;
}
```

The **`application_fee_amount`** pattern is Stripe's direct-charges
model. Simpler than "charge platform + separate transfer" and
correctly handles refunds (both platform fee and developer net
reverse proportionally).

### 3. Refund handling

```ts
// Webhook: charge.refunded
export async function onChargeRefunded(event: Stripe.Event) {
  const charge = event.data.object as Stripe.Charge;
  const sale = await loadSaleByPaymentIntent(charge.payment_intent as string);
  if (!sale) return;

  const refundedMinor = charge.amount_refunded;
  await updateSaleRefund(sale.id, refundedMinor);

  // If a payout already included this sale, we need to handle clawback.
  const priorPayout = await findPayoutContainingSale(sale.id);
  if (priorPayout && priorPayout.status === 'paid') {
    // Clawback: reduce next payout by the proportional amount.
    await scheduleClawback({
      developerAccountId: priorPayout.developerAccountId,
      saleId: sale.id,
      amountMinor: Math.floor((refundedMinor * sale.developerNetMinor) / sale.grossMinor),
      reason: 'refund',
    });
  }

  await writeAuditEvent({
    kind: 'marketplace.refund',
    subjectId: sale.id,
    payload: { refundedMinor, priorPayoutId: priorPayout?.id ?? null },
  });
}
```

**Never reverse a paid payout directly** — pull from future payouts or
invoice the developer if balance goes negative.

### 4. Payout cycle — scheduled worker

```ts
// packages/marketplace/src/payouts/cycle.ts
// Runs daily via cron-jobs.md; per developer account.
export async function runPayoutCycle(developerAccountId: string) {
  const dev = await loadDeveloper(developerAccountId);
  if (!dev.stripeConnectAccountId) return;
  if (dev.payoutsHeld) return;                   // admin hold

  const acct = await stripe.accounts.retrieve(dev.stripeConnectAccountId);
  if (!acct.payouts_enabled) return;              // KYC incomplete

  // Since Stripe handles the actual payout to developer bank,
  // we mostly RECORD the payout event and correlate with `payout.paid` webhook.
  // Our job is to: (a) apply any clawbacks, (b) apply tax withholding,
  // (c) emit taxable-income events for reporting.
  const clawbacks = await pendingClawbacks(developerAccountId);
  for (const cb of clawbacks) {
    await applyClawback(cb);
  }

  // Everything else happens through webhook correlation — see next section.
}
```

### 5. Webhook correlation — `payout.paid`

```ts
// Webhook: payout.paid (fires for Stripe's payout to developer's bank)
export async function onPayoutPaid(event: Stripe.Event) {
  const po = event.data.object as Stripe.Payout;
  const acctId = event.account;              // connected account id
  const dev = await loadDeveloperByStripeAccount(acctId);
  if (!dev) return;

  // List sales included (by period).
  const sales = await salesInPayoutPeriod(dev.id, po.arrival_date);
  const net = sales.reduce((s, x) => s + x.developerNetMinor - x.refundedMinor, 0);

  const payout = await insertPayout({
    id: crypto.randomUUID(),
    developerAccountId: dev.id,
    stripeTransferId: null,
    stripePayoutId: po.id,
    periodStart: new Date(po.arrival_date * 1000 - 7 * 86400_000).toISOString(),
    periodEnd: new Date(po.arrival_date * 1000).toISOString(),
    grossMinor: sales.reduce((s, x) => s + x.grossMinor, 0),
    refundsMinor: sales.reduce((s, x) => s + x.refundedMinor, 0),
    chargebacksMinor: sales.reduce((s, x) => s + x.chargebackMinor, 0),
    holdsMinor: 0,
    taxWithholdingMinor: 0,
    netPaidMinor: po.amount,
    currency: po.currency,
    status: 'paid',
    saleIds: sales.map((s) => s.id),
    createdAt: new Date().toISOString(),
    paidAt: new Date(po.arrival_date * 1000).toISOString(),
    failureReason: null,
  });

  // Emit taxable-income event for DAC7 / 1099-K aggregation.
  await emitTaxableIncomeEvent({
    accountId: dev.id,
    amountMinor: po.amount,
    currency: po.currency,
    category: 'marketplace_payout',
    occurredAt: new Date(po.arrival_date * 1000).toISOString(),
  });

  // Developer-facing webhook.
  await dispatchOutboundWebhook(dev.id, 'payout.paid', {
    payoutId: payout.id,
    amountMinor: po.amount,
    currency: po.currency,
    periodStart: payout.periodStart,
    periodEnd: payout.periodEnd,
  });

  await writeAuditEvent({ kind: 'marketplace.payout.paid', subjectId: dev.id, payload: payout });
}
```

### 6. Holds — moderation + fraud

```ts
// packages/marketplace/src/payouts/hold.ts
export async function holdDeveloperPayouts(developerAccountId: string, reason: 'fraud_review' | 'moderation_action' | 'tax_cert_missing', operatorId: string, note: string) {
  await db.update(developer).set({ payoutsHeld: true, payoutsHoldReason: reason })
    .where(eq(developer.id, developerAccountId));

  // Flip Stripe Connect account to manual payouts.
  const dev = await loadDeveloper(developerAccountId);
  if (dev.stripeConnectAccountId) {
    await stripe.accounts.update(dev.stripeConnectAccountId, {
      settings: { payouts: { schedule: { interval: 'manual' } } },
    });
  }
  await writeAuditEvent({
    kind: 'marketplace.payout.held',
    subjectId: operatorId,
    payload: { developerAccountId, reason, note },
  });
  await notifyDeveloper(developerAccountId, 'payouts-held', { reason, note });
}

export async function releaseDeveloperPayouts(developerAccountId: string, operatorId: string, note: string) {
  await db.update(developer).set({ payoutsHeld: false, payoutsHoldReason: null })
    .where(eq(developer.id, developerAccountId));
  const dev = await loadDeveloper(developerAccountId);
  if (dev.stripeConnectAccountId) {
    await stripe.accounts.update(dev.stripeConnectAccountId, {
      settings: { payouts: { schedule: { interval: 'daily' } } },
    });
  }
  await writeAuditEvent({
    kind: 'marketplace.payout.released',
    subjectId: operatorId,
    payload: { developerAccountId, note },
  });
}
```

Automatic holds happen when: (1) app flagged by
[content-moderation.md](content-moderation.md), (2) chargeback rate
> 1%, (3) refund rate > 20% in 30 days, (4) developer's tax-id is
missing or invalid.

### 7. Year-end reporting — DAC7 / 1099-K

```ts
// packages/marketplace/src/payouts/reporting.ts
export async function generateReportingForYear(year: number) {
  const sellers = await listDevelopersWithPayoutsInYear(year);
  for (const seller of sellers) {
    const agg = await aggregateTaxableIncome({ accountId: seller.id, year });

    if (seller.country === 'US') {
      // 1099-K threshold (2024+): $600 gross (TCJA); pre-2024: $20k + 200 txns.
      if (agg.totalMinor >= 60000) {
        await generate1099K({
          developerAccountId: seller.id,
          year,
          grossMinor: agg.totalMinor,
          transactions: agg.transactions,
        });
      }
    } else if (EU_COUNTRIES.includes(seller.country)) {
      // DAC7 threshold: €2,000 AND ≥30 transactions.
      if (agg.totalMinor >= 200_000 && agg.transactions >= 30) {
        await generateDAC7Report({
          developerAccountId: seller.id,
          year,
          grossMinor: agg.totalMinor,
          transactions: agg.transactions,
        });
      }
    }
  }
}
```

Filing itself is usually done through an accountant + tax-authority
portal; this code generates the summary data. For US 1099-K,
**Stripe Connect generates 1099s automatically** if you enable the
feature — consider that before rolling your own.

### 8. Developer portal — earnings dashboard

```svelte
<!-- src/routes/developer/[appId]/earnings/+page.svelte -->
<h1>{data.app.name} — earnings</h1>

<section aria-labelledby="this-month">
  <h2 id="this-month">This month</h2>
  <dl>
    <dt>Gross</dt><dd>{format(data.thisMonth.grossMinor, data.currency)}</dd>
    <dt>Platform fee (30%)</dt><dd>-{format(data.thisMonth.platformCutMinor, data.currency)}</dd>
    <dt>Refunds</dt><dd>-{format(data.thisMonth.refundsMinor, data.currency)}</dd>
    <dt>Net to you</dt><dd><strong>{format(data.thisMonth.netMinor, data.currency)}</strong></dd>
  </dl>
</section>

<section aria-labelledby="payouts">
  <h2 id="payouts">Payout history</h2>
  <table>
    <thead><tr><th>Period</th><th>Net</th><th>Status</th></tr></thead>
    <tbody>
      {#each data.payouts as p}
        <tr>
          <td>{p.periodStart.slice(0, 10)} → {p.periodEnd.slice(0, 10)}</td>
          <td>{format(p.netPaidMinor, p.currency)}</td>
          <td class="status-{p.status}">{p.status}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</section>
```

## A11y invariants

- Earnings figures use `<bdi>` for number direction in RTL locales.
- Dashboard dates are `<time>` elements with `datetime` attribute.
- "Payout held" notice is an `<aside role="note" aria-label="Payouts
  on hold">` with clear reason and next-action link.
- Amounts use locale-formatted strings via `Intl.NumberFormat`.
- Status column has real text ("paid", "held"), not color-only.

## Security invariants

- Platform fee is **server-computed** from `RevenueShare` rows. Client
  cannot influence.
- `application_fee_amount` is the only Stripe-level fee; never
  manually transfer to attempt higher cuts.
- Stripe Connect account id is stored against developer record;
  **cross-developer leak** is catastrophic.
- Webhook signature verification — standard.
- Clawbacks never pull from paid payouts; only from future balance.
- Payout holds require `payouts:admin` + audit note.
- Tax forms are stored via [signed-urls.md](signed-urls.md) with 1-year
  developer-viewable signed links.

## Testing

```ts
test('refund creates clawback against future payouts when prior payout was paid', async () => {
  await recordSale({ grossMinor: 10_000, platformCutMinor: 3_000, developerNetMinor: 7_000 });
  await simulatePayoutPaid(/* includes that sale */);
  await simulateChargeRefunded({ amountRefunded: 10_000 });
  const cb = await loadClawback();
  expect(cb.amountMinor).toBe(7_000);
});
```

## Anti-patterns

1. **Computing platform fee in the client** — trivially bypassed.
2. **Manually transferring instead of `application_fee_amount`** —
   refund math gets wrong; double-taxed developer.
3. **Paying out before KYC complete** — Stripe blocks it; our job
   is to not even try.
4. **Pulling from paid payouts** — use clawbacks against future
   balance only.
5. **No hold mechanism** — fraud wave hits, no kill switch.
6. **Payout scheduling via `setTimeout`** — process restart wipes
   timers. Use a durable scheduler ([cron-jobs.md](cron-jobs.md)).
7. **Float money math** — integer minor units only.
8. **No `idempotencyKey` on sale creation** — duplicate charges.
9. **Per-sale transfers instead of application_fee** — 3x Stripe
   fees; slow reconciliation.
10. **Not recording `shareRateId`** per sale — rate changes over
    time; without a snapshot you can't prove what cut applied.
11. **No DAC7/1099-K aggregation** — tax authority audit blindside.
12. **Showing developer the buyer's full identity** — privacy leak
    beyond what's needed for support.
13. **Listing sales in admin UI with no `payouts:admin` gate** —
    confidential revenue data.
14. **Treating chargebacks like refunds** — chargebacks come with
    fees + risk-flag; separate accounting.
15. **Developer self-serve changing bank account without 2FA/MFA** —
    ATO on developer account → redirect payouts.
16. **Payout currency != sale currency without FX recording** — FX
    losses are invisible but real.
17. **No per-app cap on single-sale amount** — a buggy app puts
    $50k through; clamp at a sanity threshold.
18. **Exposing Stripe Connect account id** in developer API — not
    sensitive alone but combined with other leaks is a vector.
19. **Same `application_fee_amount` regardless of processor fee** —
    developer pays for Stripe's fee twice.
20. **Webhook handler not idempotent** — duplicate payout rows.
21. **Holding payouts silently without notifying developer** — support
    escalation.
22. **Reversed payouts without audit note** — no way to show the
    developer why.
23. **Year-end reporting on-demand during filing week** — aggregate
    monthly; file with pre-computed data.
24. **Tax form stored in public bucket** — PII leak.
25. **Not verifying chargebacks ≤1% before releasing hold** — released
    too early → more chargebacks → Stripe risk-review.

## References

- ADRs: [0019](../adr/0019-http-client-and-error-model.md),
  [0023](../adr/0023-compliance-audit-log-contract.md)
- Siblings:
  [oauth-app-marketplace.md](oauth-app-marketplace.md),
  [payments.md](payments.md), [billing-tax.md](billing-tax.md),
  [pricing-plans-changes.md](pricing-plans-changes.md),
  [content-moderation.md](content-moderation.md),
  [webhooks-outbound.md](webhooks-outbound.md)
- Stripe Connect: https://stripe.com/docs/connect
- IRS 1099-K (post-TCJA thresholds)
- EU DAC7 (Directive 2021/514)
