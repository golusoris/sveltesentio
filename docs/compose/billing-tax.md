# billing-tax.md — composition recipe

> **Tax calculation, collection, and reporting for a SaaS product.**
> sveltesentio delegates the hard parts (jurisdiction resolution,
> rate tables, nexus determination) to **Stripe Tax** as the default,
> with **TaxJar/Avalara AvaTax** as enterprise escape hatches. The
> recipe documents: tax-ID collection (VAT, GST, ABN, HST), B2B
> reverse-charge, per-region invoicing requirements, cash-reward tax
> events from [referral-program.md](referral-program.md), and
> platform-operator reporting (DAC7, 1099-K). Per
> [ADR-0019](../adr/0019-http-client-and-error-model.md) all
> boundary schemas are Zod; per
> [ADR-0023](../adr/0023-compliance-audit-log-contract.md) tax-rate
> decisions are audit-logged to support tax-authority audits.

> **Don't DIY tax.** Rate tables change daily; nexus rules differ per
> state/country/city; exemption certificates have validity windows;
> VAT reverse-charge wording is legally prescribed. Delegate to a
> provider and own only the **integration**.

## Related

- [payments.md](payments.md) — Stripe PaymentIntents use `automatic_tax`
- [pricing-plans-changes.md](pricing-plans-changes.md) — plan changes
  trigger re-quotes with current tax
- [billing-usage-metering.md](billing-usage-metering.md) — usage
  records inherit the invoice's resolved tax
- [tenant-provisioning.md](tenant-provisioning.md) — collect
  country + address + tax-ID during onboarding
- [referral-program.md](referral-program.md) — cash rewards ≥$600/yr
  (US) or €2,000/yr (DAC7) emit taxable-income events
- [marketplace-payouts.md](marketplace-payouts.md) — platform-operator
  reporting obligations (1099-K, DAC7)
- [gdpr-data-export.md](gdpr-data-export.md) — tax records are part of
  the export
- [audit-log.md](audit-log.md) — rate decisions logged for audits
- [data-migrations.md](data-migrations.md) — tax records are
  append-only; corrections are new entries
- [ADR-0019](../adr/0019-http-client-and-error-model.md),
  [ADR-0023](../adr/0023-compliance-audit-log-contract.md)

## When to use what

```text
Global SaaS, B2C + B2B, < $10M ARR          → Stripe Tax (this recipe default)
                                              ready out-of-box; covers 50+ countries
Global SaaS, > $10M ARR or complex nexus    → Avalara AvaTax / TaxJar escape
                                              multi-entity, exemption certs, hold-outs
US-only SaaS, few states                    → Stripe Tax OR manual per-state
                                              breakeven at ~5 states with Stripe
EU-only SaaS                                → Stripe Tax + OSS/IOSS registration
                                              one EU VAT return instead of 27
Physical goods                              → Avalara or TaxJar mandatory
                                              physical nexus triggers are brutal
Marketplace (seller-of-record)              → platform collects; DAC7 / 1099-K apply
Marketplace (facilitator-only)              → sellers collect; platform reports
Digital services to consumers (B2C)         → VAT MOSS / VAT OSS (EU); US origin-based
Reverse-charge eligible B2B buyer (EU)      → no VAT charged; "Reverse charge" wording
Non-profit / tax-exempt buyer               → exemption certificate on file; skip tax
Referral cash rewards                        → 1099-MISC/NEC (US) or DAC7 (EU)
                                              emit taxable-income events on grant
```

## The three sub-systems

```text
1. Quote-time tax calc          ← when the customer sees a price
   Stripe.tax.calculations.create OR Stripe.automatic_tax = true
   Inputs: buyer country, postal code, tax-ID, line items
   Output: per-line tax + display text ("VAT 19%", "Sales tax 8.875%")

2. Invoice-time tax snapshot    ← when the invoice finalizes
   Stored in the invoice line; IMMUTABLE after finalization
   Stripe Invoice.tax_amounts + lines[i].tax_amounts

3. Reporting                    ← monthly/quarterly/annually
   Pull from Stripe via their tax reports API
   Reconcile against our local audit-log
   File to tax authorities (out of scope for code; use Stripe Tax Registrations)
```

## Shape — bounded Zod

```ts
// packages/billing/src/tax/types.ts
import { z } from 'zod';

// ISO-3166-1 alpha-2
export const CountryCode = z.string().regex(/^[A-Z]{2}$/);

// Tax-ID kinds supported by Stripe Tax. Not exhaustive; extend as needed.
export const TaxIdKind = z.enum([
  'eu_vat',     // EU VAT: DE123456789
  'gb_vat',     // UK VAT: GB123456789
  'us_ein',     // US EIN (B2B): 12-3456789
  'au_abn',     // Australian Business Number
  'ca_gst_hst', // Canadian GST/HST
  'ch_vat',     // Swiss VAT
  'jp_cn',      // Japan Corporate Number
  'br_cnpj',    // Brazilian CNPJ
  'in_gst',     // India GST
]);
export type TaxIdKind = z.infer<typeof TaxIdKind>;

export const TaxId = z.object({
  kind: TaxIdKind,
  value: z.string().trim().min(3).max(30),
  // Validation status from Stripe Tax ID verification endpoint.
  status: z.enum(['unverified', 'verified', 'unavailable', 'unrecognized']).default('unverified'),
  verifiedAt: z.string().datetime({ offset: true }).nullable(),
});

export const BillingAddress = z.object({
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).optional(),
  city: z.string().min(1).max(120),
  postalCode: z.string().min(1).max(20),
  state: z.string().max(40).optional(),   // required for US/CA/AU
  country: CountryCode,
});

export const TaxableCustomer = z.object({
  customerId: z.string().min(1),                     // Stripe customer id
  address: BillingAddress,
  taxIds: z.array(TaxId).max(10).default([]),
  // "B2C" or "B2B"; inferred from presence of verified business tax-id.
  kind: z.enum(['B2C', 'B2B']),
});

export const TaxQuote = z.object({
  amountMinor: z.number().int().min(0),              // total tax in minor units
  currency: z.string().regex(/^[a-z]{3}$/),
  inclusive: z.boolean(),                             // tax-inclusive or exclusive pricing
  breakdown: z.array(z.object({
    jurisdiction: z.string().max(100),               // "US-CA", "DE", "EU-OSS"
    taxTypeLabel: z.string().max(40),                // "VAT", "Sales tax", "GST"
    ratePercent: z.number().min(0).max(100),
    amountMinor: z.number().int().min(0),
    reverseCharge: z.boolean().default(false),
  })).max(20),
  resolvedAt: z.string().datetime({ offset: true }),
});
```

## Reference pattern

### 1. Collect buyer data at checkout

```svelte
<!-- src/routes/checkout/+page.svelte — partial -->
<script lang="ts">
  import { CountryCode, TaxIdKind } from '@sveltesentio/billing/tax';
  // Stripe Elements <AddressElement mode="billing" /> collects structured address.
</script>

<form method="POST" use:enhance>
  <fieldset>
    <legend>Billing address</legend>
    <!-- Stripe AddressElement -->
    <div id="address-element"></div>
  </fieldset>

  <fieldset>
    <legend>Business information (optional)</legend>
    <label>
      Tax ID type
      <select name="taxIdKind">
        <option value="">Individual / not applicable</option>
        <option value="eu_vat">EU VAT</option>
        <option value="gb_vat">UK VAT</option>
        <option value="us_ein">US EIN</option>
        <option value="au_abn">AU ABN</option>
        <option value="ca_gst_hst">CA GST/HST</option>
      </select>
    </label>
    <label>
      Tax ID value
      <input name="taxIdValue" placeholder="DE123456789" />
    </label>
  </fieldset>
  <!-- ... -->
</form>
```

Tax-ID format validation happens server-side via Stripe
`TaxIds.create` — the Stripe API rejects malformed values with a
structured error that we map to a 422.

### 2. Server-side — create Stripe Tax calculation

```ts
// packages/billing/src/tax/calculate.ts
import Stripe from 'stripe';
import { TaxQuote } from './types';

const stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2024-11-20.acacia' });

export async function calculateTax(input: {
  customerId: string;
  currency: string;
  lineItems: Array<{ amount: number; quantity: number; reference: string; taxCode?: string }>;
}): Promise<TaxQuote> {
  const calc = await stripe.tax.calculations.create({
    currency: input.currency,
    customer: input.customerId,
    line_items: input.lineItems.map((l) => ({
      amount: l.amount,
      quantity: l.quantity,
      reference: l.reference,
      tax_code: l.taxCode ?? 'txcd_10000000', // general SaaS
      tax_behavior: 'exclusive',
    })),
    expand: ['line_items.data.tax_breakdown'],
  });

  const breakdown = (calc.line_items?.data ?? []).flatMap((li) =>
    (li.tax_breakdown ?? []).map((b) => ({
      jurisdiction: `${b.jurisdiction.country}${b.jurisdiction.state ? '-' + b.jurisdiction.state : ''}`,
      taxTypeLabel: b.jurisdiction.display_name ?? b.tax_rate_details?.tax_type ?? 'Tax',
      ratePercent: Number(b.tax_rate_details?.percentage_decimal ?? 0),
      amountMinor: b.amount,
      reverseCharge: b.taxability_reason === 'reverse_charge',
    })),
  );

  return TaxQuote.parse({
    amountMinor: calc.tax_amount_exclusive,
    currency: calc.currency,
    inclusive: false,
    breakdown,
    resolvedAt: new Date().toISOString(),
  });
}
```

**Tax code** (`txcd_10000000` for general SaaS, `txcd_10103000` for
downloadable software, `txcd_20010001` for consulting services) is
the single most consequential input. Get the right code from Stripe's
tax-code catalog; the wrong code yields the wrong rate.

### 3. Tax-ID verification

```ts
// packages/billing/src/tax/verify-id.ts
export async function attachAndVerifyTaxId(customerId: string, kind: TaxIdKind, value: string) {
  // Map our enum → Stripe's tax-id kind.
  const stripeKind = mapToStripeKind(kind);
  const taxId = await stripe.customers.createTaxId(customerId, { type: stripeKind, value });

  // Wait for verification status (async, usually < 10s).
  return { stripeId: taxId.id, initialStatus: taxId.verification?.status ?? 'unverified' };
}

// Webhook handler updates the local record.
export async function handleTaxIdVerificationWebhook(event: Stripe.Event) {
  if (event.type !== 'customer.tax_id.updated') return;
  const ti = event.data.object as Stripe.TaxId;
  await updateLocalTaxIdStatus(ti.customer as string, ti.value, ti.verification?.status ?? 'unverified');
  await writeAuditEvent({
    kind: 'tax.id.verified',
    subjectId: ti.customer as string,
    payload: { value: maskTaxId(ti.value), status: ti.verification?.status },
  });
}
```

`verified` tax IDs unlock B2B pricing (no VAT charged for EU
reverse-charge; exempt for US EIN where applicable). `unverified`
tax IDs still count as B2B indication but the buyer is charged
normally until verification completes.

### 4. Reverse-charge on EU B2B invoices

```ts
// packages/billing/src/tax/reverse-charge.ts
export function shouldApplyReverseCharge(buyer: TaxableCustomer, sellerCountry: string): boolean {
  // EU reverse-charge: seller in one EU country, B2B buyer in another EU country
  // with verified EU VAT id.
  if (!EU_COUNTRIES.includes(sellerCountry)) return false;
  if (!EU_COUNTRIES.includes(buyer.address.country)) return false;
  if (buyer.address.country === sellerCountry) return false;
  const euVat = buyer.taxIds.find((t) => t.kind === 'eu_vat' && t.status === 'verified');
  return Boolean(euVat);
}
```

Stripe Tax handles this automatically when the tax-id is attached
and verified; the recipe documents the contract so operators know
what to expect on the invoice:

- Invoice line: **Subtotal** shown without VAT.
- Invoice line: **"Reverse charge — VAT to be accounted for by the
  recipient, Article 196 Directive 2006/112/EC"** (or local
  equivalent wording per buyer country).
- Buyer's VAT id printed on the invoice — **required**.
- Seller's VAT id printed on the invoice — **required**.

### 5. Invoice finalization → immutable tax snapshot

```ts
// packages/billing/src/tax/snapshot.ts
// Called on `invoice.finalized` webhook.
export async function snapshotTaxAtFinalization(invoice: Stripe.Invoice) {
  const lineTaxRows = (invoice.lines?.data ?? []).flatMap((line) =>
    (line.tax_amounts ?? []).map((ta) => ({
      invoiceId: invoice.id,
      invoiceLineId: line.id,
      taxRateId: (ta.tax_rate as any).id,
      ratePercent: Number((ta.tax_rate as any).percentage ?? 0),
      jurisdiction: [(ta.tax_rate as any).country, (ta.tax_rate as any).state].filter(Boolean).join('-'),
      amountMinor: ta.amount,
      reverseCharge: (ta as any).taxability_reason === 'reverse_charge',
    })),
  );

  await db.insert(invoiceTaxSnapshot).values(lineTaxRows);
  await writeAuditEvent({
    kind: 'tax.invoice.snapshot',
    subjectId: invoice.customer as string,
    payload: { invoiceId: invoice.id, totalTaxMinor: invoice.tax ?? 0, lines: lineTaxRows.length },
  });
}
```

Once finalized, the tax amount on the invoice is **immutable**.
Corrections require a credit note + new invoice, not an edit.

### 6. Cash-reward taxable income (from referral-program.md)

```ts
// packages/billing/src/tax/taxable-income.ts
export async function emitTaxableIncomeEvent(input: {
  accountId: string;
  amountMinor: number;
  currency: string;
  category: 'referral_reward' | 'marketplace_payout' | 'contest_prize';
  occurredAt: string;
}) {
  await db.insert(taxableIncomeEvent).values({
    id: crypto.randomUUID(),
    ...input,
    reportedToAuthority: false,
    reportingYear: new Date(input.occurredAt).getUTCFullYear(),
  });
  await writeAuditEvent({
    kind: 'tax.income_event',
    subjectId: input.accountId,
    payload: input,
  });
}
```

Aggregated per recipient + per calendar year → if annual total crosses
**$600 (US 1099-MISC/NEC)** or **€2,000 + 30 transactions (EU DAC7)**,
the operator must issue the form. See
[marketplace-payouts.md](marketplace-payouts.md) for the filing flow.

### 7. Exemption certificates

For US B2B buyers claiming sales-tax exemption (non-profit, resale,
government), collect the exemption certificate:

```ts
// packages/billing/src/tax/exemption.ts
export const ExemptionCertificate = z.object({
  id: z.string().uuid(),
  customerId: z.string(),
  kind: z.enum(['nonprofit', 'resale', 'government', 'educational']),
  // Certificate file stored via signed-urls.md
  fileKey: z.string(),
  effectiveFrom: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),   // certs expire
  states: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1),  // US states where valid
  status: z.enum(['pending_review', 'active', 'expired', 'rejected']),
});
```

When a customer has an **active, non-expired** certificate for the
invoice's state, we set Stripe Customer's `tax_exempt: 'exempt'` and
skip tax calc; otherwise charge normally.

**Expiry handling**: a scheduled job runs daily; 30 days before
`expiresAt`, notify the customer; on expiry, revert
`tax_exempt: 'none'` and email them.

### 8. Reporting dashboard

```svelte
<!-- src/routes/admin/tax/reports/+page.svelte -->
<h1>Tax reports</h1>
<p>
  These reports pull from Stripe Tax registration reports; always
  reconcile against our local <code>invoiceTaxSnapshot</code> table
  before filing.
</p>
<table>
  <thead><tr><th>Period</th><th>Jurisdiction</th><th>Gross</th><th>Tax</th><th>Stripe report</th></tr></thead>
  <tbody>
    {#each data.periods as p}
      <tr>
        <td>{p.period}</td>
        <td>{p.jurisdiction}</td>
        <td>{(p.grossMinor / 100).toLocaleString()}</td>
        <td>{(p.taxMinor / 100).toLocaleString()}</td>
        <td><a href={p.stripeReportUrl} target="_blank" rel="noopener">Stripe</a></td>
      </tr>
    {/each}
  </tbody>
</table>
```

## A11y invariants

- Tax-ID input has a real `<label>` and a `<datalist>` or select for
  the kind.
- Error messages for invalid tax IDs are associated via
  `aria-describedby`.
- Invoice tax lines use a `<table>` with a `<caption>` describing the
  invoice id.
- Per-jurisdiction tax rows use `<th scope="row">` for the
  jurisdiction name.
- Tax-amount figures use `<bdi>` or `dir="ltr"` when rendered inside
  RTL locales (numbers stay LTR).

## Security invariants

- Tax IDs are **PII** — masked in logs (`DE******789`), never emailed
  in plaintext after onboarding.
- Stripe is the source of truth for tax amounts — our snapshot is a
  **local mirror for audit**, not a calculation authority.
- Webhook signature verification on every Stripe event — see
  [webhooks.md](webhooks.md).
- Tax-exempt certificates are files stored via
  [signed-urls.md](signed-urls.md) with 1-hour TTL.
- Corrections create new invoice records + credit notes; never
  `UPDATE` a finalized invoice.
- Currency is stored as **ISO-4217 code + minor units** (integer);
  never `0.01 + 0.02 = 0.03` float arithmetic.

## Testing

```ts
// tests/billing/tax/calculation.test.ts
test('EU reverse-charge zeroes VAT with verified VAT id', async () => {
  const quote = await calculateTax({
    customerId: 'cus_eu_verified',
    currency: 'eur',
    lineItems: [{ amount: 10_000, quantity: 1, reference: 'plan_pro' }],
  });
  expect(quote.amountMinor).toBe(0);
  expect(quote.breakdown.some((b) => b.reverseCharge)).toBe(true);
});

test('US sales tax applied to non-exempt customer', async () => {
  const quote = await calculateTax({
    customerId: 'cus_us_ca',
    currency: 'usd',
    lineItems: [{ amount: 10_000, quantity: 1, reference: 'plan_pro' }],
  });
  expect(quote.amountMinor).toBeGreaterThan(0);
  expect(quote.breakdown.some((b) => b.jurisdiction.startsWith('US-'))).toBe(true);
});
```

Integration tests run against Stripe test mode with seeded customers
(one per jurisdiction of interest).

## Anti-patterns

1. **Hardcoding tax rates** — they change. Delegate to Stripe Tax.
2. **Computing tax in the client** — wrong in most jurisdictions, and
   the display wording is legally prescribed.
3. **Float arithmetic for money/tax** — `0.1 + 0.2 = 0.30000...4`.
   Minor units (integer cents) only.
4. **Omitting buyer's VAT id on B2B EU invoices** — invoice is
   non-compliant; customer can't reclaim VAT.
5. **Missing "Reverse charge" wording on EU B2B cross-border** —
   auditable gap; buyer reports incorrectly.
6. **Trusting an unverified tax-ID for B2B pricing** — fraud; verify
   via Stripe before applying B2B treatment.
7. **Editing a finalized invoice's tax amount** — illegal in most
   jurisdictions; correct via credit note + new invoice.
8. **Not storing the tax-code per product** — wrong category means
   wrong rate; especially digital-vs-physical.
9. **Caching tax quotes client-side across page loads** — price +
   address changes, stale quote applied at checkout.
10. **Skipping tax-ID re-verification on address change** — EU buyer
    moves from DE → CH; their EU VAT id no longer applies.
11. **Not expiring exemption certificates** — certs have validity
    windows; expired certs are invalid.
12. **Storing certificate images in public bucket** — PII leak; use
    signed URLs with short TTL.
13. **Manual tax filings from memory** — Stripe Tax Registrations
    auto-files in supported countries; use it.
14. **Exposing other customers' tax details** in admin UI without
    `tax:admin` permission — data-leak vector.
15. **Logging full tax-ID values** in debug/info logs — mask before
    logging.
16. **Ignoring `customer.tax_id.updated` webhook** — verification is
    async; you'll miss the transition from unverified → verified.
17. **Charging tax on reverse-charge invoices** — customer complains;
    refund + reissue.
18. **Rounding per line** instead of per invoice — rounding errors
    compound; follow Stripe's rounding rules.
19. **Mixing inclusive and exclusive pricing** on same invoice —
    impossible to reconcile.
20. **No per-jurisdiction gross tracking** — can't file returns.
21. **Handling currency conversion in-house** — FX on tax amounts is
    a minefield; let Stripe or the bank do it.
22. **Treating digital + physical the same** — they have different
    tax treatments in EU and most US states.
23. **Reporting cash rewards manually without audit trail** —
    1099/DAC7 dispute → no defense.
24. **Throwing generic 500 on tax calc failure** — fail soft with
    a retry; 500 at checkout kills conversion.
25. **No tax fallback when Stripe Tax is down** — decide in advance:
    block checkout (strict) or quote 0-tax and reconcile (lenient).

## References

- ADRs: [0019](../adr/0019-http-client-and-error-model.md),
  [0023](../adr/0023-compliance-audit-log-contract.md)
- Siblings: [payments.md](payments.md),
  [pricing-plans-changes.md](pricing-plans-changes.md),
  [billing-usage-metering.md](billing-usage-metering.md),
  [marketplace-payouts.md](marketplace-payouts.md),
  [referral-program.md](referral-program.md),
  [tenant-provisioning.md](tenant-provisioning.md)
- Stripe Tax docs: https://stripe.com/docs/tax
- EU Directive 2006/112/EC — VAT rules
- IRS 1099-MISC / 1099-NEC thresholds
- OECD DAC7 (EU Directive 2021/514) — digital platform reporting
