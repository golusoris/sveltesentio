# Payments — Stripe Elements + Checkout + webhook-driven state reconciliation

Payment integrations fail in specific, expensive ways: a client
"succeeds" but the webhook never arrives, a user reloads mid-3DS and
ends up with a double charge, a database write commits but the
payment-intent confirmation times out, a test-mode key leaks into
production and the first real customer gets rejected. The only
durable pattern is to treat the **payment provider's webhook as the
source of truth for state** and the client-side UI as a best-effort
optimistic hint.

This recipe picks **Stripe** as default (deepest docs, strongest
SDK, widest card support), codifies the Elements-vs-Checkout
decision, locks down the webhook reconciliation contract per
[webhooks.md](webhooks.md), and maps subscription lifecycle events
to [audit-log.md](audit-log.md) compliance entries. Per
[principles.md §2.2](../principles.md) (OWASP ASVS L2 V6 — sensitive
data handling) and [ADR-0019](../adr/0019-structured-error-envelope.md)
(structured error envelopes), no card PAN ever touches our server,
no payment state is believed from a client callback, and every
money-moving event is audited.

## Related

- [webhooks.md](webhooks.md) — payment-provider webhooks (Stripe,
  PayPal, Adyen) use the exact HMAC-verified receiver + dedup
  pattern. Re-read before writing a webhook endpoint.
- [audit-log.md](audit-log.md) — subscription created/canceled/
  upgraded + webhook-received are audit events with 7-year retention.
- [observability.md](observability.md) — `payment.intent.status`
  bounded span attribute; `correlation.id` threads client →
  server → webhook.
- [http-client.md](http-client.md) — `Idempotency-Key` on every
  payment mutation; Stripe enforces this natively.
- [feature-flags.md](feature-flags.md) — gate new payment flows
  (new currency, new provider, SCA upgrade) through flag rollout.
- [schemas.md](schemas.md) — Zod schemas at every boundary;
  provider SDK types are suggestions, not boundaries.
- [forms.md](forms.md) — checkout form state via Superforms;
  card-number input never goes through Superforms (it's in a Stripe
  iframe).
- [auth-oidc.md](auth-oidc.md) — Stripe Customer IDs link to
  authenticated user sessions; never key payments by client-supplied
  fields.
- [rate-limiting.md](rate-limiting.md) — payment-intent creation
  endpoints carry a tight rate-limit bucket (card-testing attack
  surface).
- [principles.md §2.2](../principles.md) — OWASP ASVS L2 V6.

## When to use Elements vs Checkout vs Payment Links

```text
Custom UI + one-page-checkout + existing cart UX             → Stripe Elements (embedded)
Low-maintenance + hosted page + tax/shipping computed by Stripe → Stripe Checkout (redirect)
Single-product / simple subscription / marketing page         → Payment Link (no code)
Mobile app + native card input                                → Stripe SDK (iOS/Android)
B2B invoice (no immediate card)                               → Stripe Invoicing + Checkout link
Recurring subscription with upgrade/downgrade UI             → Elements + Stripe Billing portal for self-serve
```

**Three build rules:**

1. **Default to Checkout** unless you have a strong UX reason to
   build your own form. Checkout handles SCA, new payment methods
   (Apple Pay / Google Pay / Klarna / iDEAL), tax calculation, and
   wallet support automatically — swapping to a new payment method
   is a Stripe Dashboard toggle, not a code change.
2. **Elements when the checkout is part of the product UX** (inline
   upgrade prompts, in-modal payment). Pay the maintenance cost
   because inline-first is a product decision.
3. **Never build a card-number input yourself.** PAN entry belongs
   in a Stripe-hosted iframe (Elements or Checkout). This is a PCI
   DSS SAQ-A vs SAQ-D distinction — self-hosting card fields
   expands PCI scope from "nothing" to "everything".

## Install

```bash
# Server
pnpm add stripe

# Client (Elements only — Checkout uses redirect, no client SDK needed)
pnpm add @stripe/stripe-js svelte-stripe

# Types + schemas
pnpm add zod
```

Environment:

```bash
# Server
STRIPE_SECRET_KEY=sk_live_…                 # test: sk_test_…
STRIPE_WEBHOOK_SECRET=whsec_…               # per-endpoint, NOT account secret
STRIPE_API_VERSION=2025-02-24.acacia        # PIN — never use account-default

# Client (public)
PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_…     # test: pk_test_…
```

**Three key rules:**

1. **API version pinned server-side.** Stripe's default "account
   version" can be bumped by a Stripe-side migration; pinning via
   `new Stripe(secret, { apiVersion })` is your upgrade gate.
2. **Test keys never in the same env var as live keys.** Different
   env files, different Vercel/Fly/… env groups. A `sk_test_*` that
   reaches prod is a silent failure — you'll discover it on the
   first real transaction.
3. **Webhook secrets are per-endpoint.** If you have a prod endpoint
   and a staging endpoint, they get different `whsec_*` values; a
   shared secret is a key-compromise blast radius.

## Shape

```text
src/routes/
  (app)/billing/
    +page.server.ts              # load: subscription status from DB
    +page.svelte                 # renders plan state + manage-billing link
    checkout/+server.ts          # POST: create CheckoutSession → redirect
    portal/+server.ts            # POST: create BillingPortal session → redirect
    success/+page.svelte         # post-redirect landing page
    cancel/+page.svelte
  api/webhooks/stripe/+server.ts # HMAC-verified webhook receiver
src/lib/payments/
  stripe.ts                      # Stripe client + types
  schemas.ts                     # Zod for DB rows + webhook event payloads
  reconcile.ts                   # webhook → DB state machine
  audit.ts                       # payment events → audit-log.md emit
packages/db/migrations/
  NNNN_payments.sql              # customers / subscriptions / events
```

## Server Stripe client

```ts
// src/lib/payments/stripe.ts
import Stripe from 'stripe';
import { STRIPE_SECRET_KEY, STRIPE_API_VERSION } from '$env/static/private';

export const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion,
  maxNetworkRetries: 2,
  timeout: 10_000,
  telemetry: false,  // don't leak user-agent-level metrics to Stripe
});
```

`maxNetworkRetries: 2` is the upper bound for idempotent retries on
transient network failures; Stripe's SDK hashes the `Idempotency-Key`
to deduplicate so a retry never charges twice.

## Checkout flow — creating the session

```ts
// src/routes/(app)/billing/checkout/+server.ts
import { error, redirect } from '@sveltejs/kit';
import { stripe } from '$lib/payments/stripe';
import { getOrCreateStripeCustomer } from '$lib/payments/customer';
import { uuidv7 } from '@sveltesentio/core';

export async function POST({ request, locals, url }) {
  const session = locals.session ?? (() => { throw error(401); })();

  const body = await request.json();
  const { priceId } = CheckoutRequest.parse(body);  // Zod — bounded price IDs

  const customerId = await getOrCreateStripeCustomer(session.userId);

  const idempotencyKey = request.headers.get('idempotency-key') ?? uuidv7();

  const checkoutSession = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${url.origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${url.origin}/billing/cancel`,
    client_reference_id: session.userId,    // stamp into session → webhook
    metadata: {
      correlationId: locals.correlationId,  // UUIDv7 for trace-join
      userId: session.userId,
    },
    allow_promotion_codes: true,
    automatic_tax: { enabled: true },
    billing_address_collection: 'required',
  }, { idempotencyKey });

  throw redirect(303, checkoutSession.url!);
}
```

**Five creation invariants:**

1. **`customer` is your DB's pinned Stripe Customer ID** — never
   `customer_email` directly. Double-customer accounts are a support
   nightmare; dedupe at our side via a `stripe_customers` table.
2. **`client_reference_id` is the `userId`** — not email, not
   cart-ID. Webhooks echo this back; the reconciliation map key is
   stable even if the user changes email.
3. **`metadata.correlationId`** threads to the webhook span for
   client → server → webhook trace-join.
4. **`allow_promotion_codes`, `automatic_tax`, `billing_address_collection`**
   are toggled at creation per session, not hard-coded — these
   matter for different product tiers and regions.
5. **`idempotencyKey`** defaults to a UUIDv7 if the client didn't
   supply one. Required for safe retries.

The response is a **303 redirect** to Stripe's hosted page — never a
JSON payload with the URL. 303 makes the back button behave correctly
on `cancel_url`.

## Client trigger — a POST form, not JSON

```svelte
<!-- src/routes/(app)/billing/+page.svelte -->
<form method="POST" action="/billing/checkout">
  <input type="hidden" name="priceId" value={plan.priceId} />
  <button type="submit">Subscribe</button>
</form>
```

The Checkout endpoint accepts a POST (not a link) so browsers treat
it as a state-changing action — no prefetch, no accidental click-
through from link-preview crawlers. For Elements, the trigger is a
client-side call to `confirmCardPayment()` — see Elements section.

## Webhook receiver — the source of truth

Every state change in our DB originates from a Stripe webhook, not
from the client redirect. The `/billing/success` page shows a
"Thanks, your subscription is activating" message; the actual row
write happens in the webhook.

```ts
// src/routes/api/webhooks/stripe/+server.ts
import { error, json } from '@sveltejs/kit';
import { stripe } from '$lib/payments/stripe';
import { STRIPE_WEBHOOK_SECRET } from '$env/static/private';
import { reconcile } from '$lib/payments/reconcile';

export async function POST({ request }) {
  const sig = request.headers.get('stripe-signature');
  if (!sig) throw error(400, 'missing_signature');

  const raw = await request.text();   // MANDATORY: raw body for signature

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, STRIPE_WEBHOOK_SECRET);
  } catch {
    throw error(401, 'signature_invalid');
  }

  // Dedup by Stripe event.id — at-least-once delivery.
  const alreadySeen = await seenEvent(event.id);
  if (alreadySeen) return json({ received: true, duplicate: true }, { status: 200 });

  try {
    await reconcile(event);
    await markSeen(event.id, event.type);
    return json({ received: true }, { status: 200 });
  } catch (err) {
    // 5xx → Stripe retries with backoff. Only use for transient errors
    // that retry will resolve. Permanent shape errors → return 200 + alert.
    throw error(500, 'reconcile_failed');
  }
}
```

**Six receiver invariants** (re-stating [webhooks.md](webhooks.md) for
Stripe specifics):

1. **`stripe.webhooks.constructEvent(raw, sig, secret)`** — never
   parse the body yourself. Stripe's SDK bundles signature verification
   + timestamp tolerance (5 min default).
2. **Dedup on `event.id`.** At-least-once delivery means duplicates
   are normal, not errors. Return 200 on duplicate — a 4xx triggers
   retry storms.
3. **Return 200 fast, do work async.** Stripe times out at 30
   seconds. If reconciliation is slow, enqueue and ack immediately
   — put the heavy work behind a queue or a background job.
4. **5xx only for transient errors.** A schema-mismatch (Stripe
   shipped a new event type you don't handle) should 200 + alert, not
   5xx — else Stripe retries forever and you alert at 03:00.
5. **Per-endpoint `whsec_*`.** The prod endpoint has a different
   secret than staging. Secret rotation is a per-endpoint operation.
6. **`event.livemode` separates test from prod.** In a shared DB,
   never commingle. Typical: separate test-mode DB, or a `livemode`
   column with RLS gating.

## Reconciliation — event → DB state machine

```ts
// src/lib/payments/reconcile.ts
import type Stripe from 'stripe';
import { emit as audit } from '@sveltesentio/audit';

export async function reconcile(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.client_reference_id;
      if (!userId) throw new Error('checkout_missing_user_ref');

      await db.transaction().execute(async (tx) => {
        await tx.insertInto('subscriptions').values({
          id: session.subscription as string,
          user_id: userId,
          customer_id: session.customer as string,
          status: 'active',
          price_id: session.line_items?.data[0]?.price?.id ?? null,
          created_at: new Date(event.created * 1000),
        }).onConflict((oc) => oc.column('id').doUpdateSet({ status: 'active' }))
          .execute();
      });

      await audit({
        actor: { type: 'user', id: userId, label: null },
        onBehalfOf: null,
        action: 'billing.subscription.created',
        target: { type: 'subscription', id: session.subscription as string, label: null },
        source: { ip: null, userAgent: null, requestId: event.id, origin: 'webhook' },
        outcome: 'success',
        reason: null,
        metadata: { priceId: session.line_items?.data[0]?.price?.id ?? '' },
      });
      break;
    }

    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      await db.updateTable('subscriptions')
        .set({
          status: sub.status,
          cancel_at: sub.cancel_at ? new Date(sub.cancel_at * 1000) : null,
          canceled_at: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
        })
        .where('id', '=', sub.id)
        .execute();

      if (event.type === 'customer.subscription.deleted') {
        await audit({
          actor: { type: 'system', id: null, label: 'stripe' },
          onBehalfOf: { type: 'user', id: sub.metadata.userId ?? '', label: null },
          action: 'billing.subscription.canceled',
          target: { type: 'subscription', id: sub.id, label: null },
          source: { ip: null, userAgent: null, requestId: event.id, origin: 'webhook' },
          outcome: 'success',
          reason: sub.cancellation_details?.reason ?? null,
          metadata: {},
        });
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      await db.updateTable('subscriptions')
        .set({ status: 'past_due' })
        .where('id', '=', invoice.subscription as string)
        .execute();
      // Trigger email via structured-emails.md
      break;
    }

    default:
      // UNHANDLED event type — log + 200. Never error on unexpected events.
      console.warn('unhandled_stripe_event', { type: event.type, id: event.id });
  }
}
```

**Five reconciliation rules:**

1. **Single-row-per-subscription primary key** from Stripe's
   `subscription.id`. Never invent your own subscription PK — it
   complicates dedup and support ticket lookups.
2. **ON CONFLICT DO UPDATE.** Events arrive out-of-order; the update
   path must be idempotent. Re-receiving `checkout.session.completed`
   after `customer.subscription.updated` must not regress state.
3. **Default branch `console.warn`, not throw.** Stripe ships new
   events regularly. Unknown-event-type should soft-warn + 200 + alert,
   never 5xx.
4. **Audit entries inside the transaction** that writes the row —
   atomic "state changed + audit recorded". Use emit-audit-after-commit
   only if the DB transaction can commit without the audit (which it
   can't for compliance-event rows).
5. **`metadata.userId` fallback when `client_reference_id` is
   null** — e.g. on subscription events that don't carry session
   data. If both are null, throw — a subscription we can't attribute
   is worse than a failed webhook.

## Stripe Billing Portal — self-serve

Instead of building upgrade/downgrade/cancel UI ourselves, create a
portal session and redirect:

```ts
// src/routes/(app)/billing/portal/+server.ts
export async function POST({ locals, url }) {
  const session = locals.session ?? (() => { throw error(401); })();
  const customerId = await getStripeCustomer(session.userId);

  const portal = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${url.origin}/billing`,
    configuration: env.STRIPE_PORTAL_CONFIG_ID,
  });

  throw redirect(303, portal.url);
}
```

The portal handles downgrades, cancellations, card updates, invoice
history, and tax-ID updates. All state changes flow back through the
webhook.

## Elements — embedded card form (when needed)

```svelte
<!-- src/lib/payments/StripeCardForm.svelte -->
<script lang="ts">
  import { Elements, PaymentElement } from 'svelte-stripe';
  import { loadStripe } from '@stripe/stripe-js';
  import { PUBLIC_STRIPE_PUBLISHABLE_KEY } from '$env/static/public';

  let { clientSecret }: { clientSecret: string } = $props();
  const stripe = loadStripe(PUBLIC_STRIPE_PUBLISHABLE_KEY);

  async function onSubmit(ev: SubmitEvent) {
    ev.preventDefault();
    const s = await stripe;
    const { error: confirmErr } = await s!.confirmPayment({
      elements: elementsInstance,
      confirmParams: { return_url: `${window.location.origin}/billing/success` },
    });
    if (confirmErr) {
      // Show user the error; DO NOT mark success.
    }
  }
</script>

<Elements stripe={stripe} clientSecret={clientSecret}>
  <form onsubmit={onSubmit}>
    <PaymentElement />
    <button type="submit">Pay</button>
  </form>
</Elements>
```

**Three Elements invariants:**

1. **`clientSecret` from a server-created PaymentIntent.** Never
   create the PaymentIntent client-side; the server controls the
   amount.
2. **Return-URL + webhook-driven success.** `confirmPayment` returns
   an error or redirects; on redirect back, trust the webhook state,
   not the redirect params.
3. **SCA is automatic.** Strong Customer Authentication challenges
   happen inside the Stripe iframe; don't try to orchestrate them.

## Rate-limiting + card-testing defense

Payment-intent creation is the #1 card-testing attack vector: bots
cycle stolen cards through a checkout endpoint to test validity.
Apply a tighter bucket per [rate-limiting.md](rate-limiting.md):

```text
POST /billing/checkout                  → 10 per 15 min per userId/IP
POST /api/payments/payment-intent       → 10 per 15 min per userId/IP
GET /billing/portal                     → 60 per hour per userId
```

Stripe also has Radar ML-based fraud detection that runs
server-side automatically; rate-limit is the first line.

## Observability

Span attributes on every payment-related route:

```ts
span.setAttributes({
  'payment.provider': 'stripe',
  'payment.intent.status': intent.status,      // bounded enum from Stripe
  'payment.mode': 'subscription',              // or 'payment' | 'setup'
  'payment.currency': intent.currency,         // 3-letter ISO
  'correlation.id': correlationId,
});
```

**Never** attach `customer_email`, card last-4, or `amount` as a
metric label (unbounded cardinality, PII). Amounts go into OTel logs
as `payment.amount_minor_units` attribute — span-only, not metric-label.

## Testing

Three lanes:

1. **Unit — reconcile state machine.** Feed canned Stripe events from
   fixtures; assert DB rows match expected. Stripe publishes event
   JSON samples in their docs.
2. **Integration — Stripe CLI `stripe listen --forward-to`.** Run
   locally, trigger test events with `stripe trigger checkout.session.completed`.
3. **Production smoke — use a dedicated "$0.01 test product" in
   live mode** with a dedicated test card alert. Run via cron at
   deploy; a failure pages.

Never write an e2e test that hits real Stripe with real amounts.

## Anti-patterns

- **Don't trust the client-side `redirect_to` return.** A returning
  customer clicking "back" re-hits `/billing/success`; the only truth
  is the webhook.
- **Don't write subscription state on the success page.** The
  webhook is the writer. `/billing/success` reads DB state — if the
  webhook hasn't arrived yet, show a spinner + poll.
- **Don't store card numbers, CVVs, or full PANs.** Ever. The whole
  point of Stripe is to never have that data on your servers. PCI
  DSS SAQ-A eligibility evaporates if you copy a card number into a
  log line, a database, or an analytics event.
- **Don't use `event.livemode = false` events in production DB.**
  Test-mode events must be isolated. Either separate database or a
  firm `WHERE livemode = true` clause on every read.
- **Don't skip idempotency keys on retries.** A transient network
  error during checkout-session-create without an idempotency key
  can create two subscriptions. Always supply one.
- **Don't put webhook handling inline in a request handler** that
  does other work. Webhook receivers are single-purpose; mixing
  concerns makes the "2xx fast" invariant hard to hold.
- **Don't use `customer_email` as a primary link.** Emails change;
  Stripe Customer IDs don't. Key by Customer ID.
- **Don't set `automatic_tax: false` for sales-tax-collection
  markets.** VAT/GST/sales-tax liability is a legal surface; let
  Stripe Tax handle it unless you have a tax accountant telling you
  otherwise.
- **Don't build your own "plans/pricing" table.** Let Stripe Products
  + Prices be the source of truth; reference `price_id` in your DB
  but never denormalize the price amount. Prices change.
- **Don't skip dunning emails on `invoice.payment_failed`.** Customers
  whose card expired need retry + notification. This is where Stripe
  Billing's built-in dunning helps; triple-check it's enabled.
- **Don't hardcode Stripe API version.** Pin via env var so rotation
  is config, not code. Stripe deprecates old versions over years;
  upgrade on your schedule.
- **Don't mix test and prod keys in the same env file.** Use
  environment-specific secret stores. A `sk_test_*` shipped to prod
  fails silently (all transactions rejected).
- **Don't expose the webhook endpoint without IP allowlist or
  signature verification.** Both together, not either-or. IP
  allowlist is a belt on the suspenders.
- **Don't implement your own 3DS / SCA flow.** Stripe handles this
  inside Elements/Checkout; rolling your own is a PSD2 compliance
  nightmare.
- **Don't use one Stripe account for multiple products** if their
  refund/chargeback policies differ. Chargeback rates are per-account;
  a high-risk product poisons a low-risk one.

## References

- [ADR-0019 — Structured error envelope (RFC 9457)](../adr/0019-structured-error-envelope.md)
- [principles.md §2.2 — OWASP ASVS L2 V6 (sensitive data)](../principles.md)
- Sibling recipes: [webhooks.md](webhooks.md),
  [audit-log.md](audit-log.md),
  [http-client.md](http-client.md),
  [schemas.md](schemas.md),
  [observability.md](observability.md),
  [rate-limiting.md](rate-limiting.md),
  [feature-flags.md](feature-flags.md),
  [forms.md](forms.md),
  [auth-oidc.md](auth-oidc.md).
- Upstream docs:
  - Stripe SvelteKit quickstart: <https://stripe.com/docs/checkout/quickstart>
  - Stripe Webhook best practices: <https://stripe.com/docs/webhooks/best-practices>
  - Stripe Idempotency: <https://stripe.com/docs/api/idempotent_requests>
  - Stripe Billing Portal: <https://stripe.com/docs/billing/subscriptions/customer-portal>
  - SCA / PSD2 overview: <https://stripe.com/docs/strong-customer-authentication>
  - PCI DSS SAQ-A scope: <https://www.pcisecuritystandards.org/document_library>
