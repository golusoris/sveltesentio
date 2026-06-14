# Inbound webhooks — HMAC verification, replay protection, idempotent delivery

[http-client.md](http-client.md) covers **outbound** HTTP — your server
calling someone else's API with `openapi-fetch`, retries, and
`Idempotency-Key`. Inbound webhooks are the inverse: a third party
(Stripe, GitHub, Linear, your own internal service) calls **your**
`+server.ts` to notify of an event. The contract is asymmetric — they
control retries, ordering, and "at-least-once" semantics; you control
verification, deduplication, and ack-or-fail signalling.

This recipe is the canonical pattern for receiving webhooks safely
across providers: signature verification on the **raw** request body,
constant-time HMAC comparison, replay protection via timestamp window +
event-ID dedup, fast 2xx ack with async work behind a queue, and the
provider-quirks table that captures what Stripe / GitHub / Slack /
generic-self-host all want differently.

## Related

- [http-client.md](http-client.md) — outbound counterpart;
  `Idempotency-Key` pattern is symmetric to dedup-by-event-ID here.
- [schemas.md](schemas.md) — Zod boundary on parsed payload;
  signature is verified **before** Zod parse (untrusted body must be
  authenticated first).
- [background-sync.md](background-sync.md) — async work behind webhook
  ack rides through the same idempotent-side-effect contract.
- [observability.md](observability.md) — webhook spans must include
  `webhook.provider` + `webhook.event_type` + `webhook.id` (low-card
  + per-event identifier ok for trace-only, never log).
- [opentelemetry-logs.md](opentelemetry-logs.md) — verification
  failures emit `WARN` with `webhook.provider` + reason (no payload).
- [cookies-authoritative.md](cookies-authoritative.md) — webhooks
  carry **no** session cookies; auth is HMAC-only.
- [http-client.md](http-client.md) §RFC 9457 — verification failure
  responses use problem+json shape.
- [principles.md §2.2](../principles.md) — OWASP ASVS L2 V12 (Web
  Service Verification).

## When this recipe applies

```text
Stripe / Linear / GitHub / Slack / any SaaS POSTing to your `+server.ts`     → mandatory
Internal service-to-service event bus over HTTP (no shared library)           → mandatory
Microservice with mTLS already negotiated                                     → HMAC optional; mTLS subsumes signature
Browser-originated POST                                                       → not a webhook; use auth-oidc.md + cookies-authoritative.md
Outbound webhook emission (you call them)                                     → not this recipe; use http-client.md with HMAC sign
```

Every webhook is a wire from the public internet directly into your
business logic with no human in the loop. Treat the endpoint as a
hardened security surface — failure mode is "attacker fabricates
`charge.succeeded` event and you ship the order".

## Install

```bash
pnpm -F @sveltesentio/auth add stripe@^17           # if using Stripe
pnpm -F @sveltesentio/auth add @octokit/webhooks@^13 # if using GitHub
# Generic providers: Node 24 native crypto.timingSafeEqual + crypto.createHmac suffice
```

## Shape — generic HMAC-SHA256 receiver

```ts
// src/routes/api/webhooks/[provider]/+server.ts
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import { dedupOrThrow } from '$lib/webhooks/dedup';
import { enqueue } from '$lib/queue';
import { logger } from '$lib/observability/logs';
import { SeverityNumber } from '@opentelemetry/api-logs';

const REPLAY_WINDOW_SECONDS = 5 * 60;

const Headers = z.object({
  'x-webhook-id': z.string().min(1),
  'x-webhook-timestamp': z.coerce.number().int().positive(),
  'x-webhook-signature': z.string().regex(/^v1=[a-f0-9]{64}$/),
});

export const POST: RequestHandler = async ({ request, params, locals }) => {
  const headers = Headers.safeParse(Object.fromEntries(request.headers));
  if (!headers.success) throw error(400, 'malformed_signature_headers');
  const { 'x-webhook-id': eventId, 'x-webhook-timestamp': ts, 'x-webhook-signature': sig } = headers.data;

  const skew = Math.abs(Date.now() / 1000 - ts);
  if (skew > REPLAY_WINDOW_SECONDS) throw error(400, 'timestamp_outside_window');

  const raw = await request.text();
  const expected = 'v1=' + createHmac('sha256', env.WEBHOOK_SECRET)
    .update(`${ts}.${raw}`)
    .digest('hex');

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    logger.emit({
      severityNumber: SeverityNumber.WARN,
      body: 'webhook signature mismatch',
      attributes: { 'webhook.provider': params.provider, 'correlation.id': locals.correlationId },
    });
    throw error(401, 'signature_mismatch');
  }

  await dedupOrThrow(params.provider!, eventId);

  const payload = JSON.parse(raw);
  await enqueue('webhook.process', { provider: params.provider, eventId, payload });

  return json({ received: true }, { status: 202 });
};
```

Six receiver invariants:

- **Signature on the raw body** — `await request.text()` once, verify
  HMAC against that exact byte sequence, parse JSON only after. Many
  providers sign the byte-for-byte body; re-serialising after `.json()`
  changes whitespace and breaks the signature.
- **Timestamp + body in the signed payload** — sign `ts.body` not just
  `body`. A signed-body-only design lets an attacker replay forever; a
  signed-`ts.body` lets you reject anything outside the replay window.
- **Constant-time comparison** — `timingSafeEqual` not `===`. String
  comparison short-circuits on the first mismatched byte and leaks
  signature bytes via timing.
- **Length check before `timingSafeEqual`** — the function throws on
  unequal-length buffers; explicit length check first.
- **Dedup by event ID** — providers retry; your handler runs at-least-once
  unless you store `(provider, eventId)` and reject duplicates.
- **Fast 2xx ack, async work behind queue** — 202 within 200ms;
  long-running side effects in the queue worker. Provider-side timeouts
  are typically 5-30s; missing the window triggers retry storms.

## Provider-specific quirks table

| Provider | Header(s) | Algo | Body in HMAC | Replay window | Notes |
|---|---|---|---|---|---|
| **Stripe** | `Stripe-Signature` (multi-value `t=`,`v1=`) | HMAC-SHA256 | `t.body` | 5 min default | Use `stripe.webhooks.constructEvent` — handles `Stripe-Signature` parsing + replay window. Raw body via `await request.text()`. |
| **GitHub** | `X-Hub-Signature-256` | HMAC-SHA256 | `body` only | none in header | No timestamp; rely on dedup-by-`X-GitHub-Delivery` UUID. Use `@octokit/webhooks` for handler routing. |
| **Slack** | `X-Slack-Signature` + `X-Slack-Request-Timestamp` | HMAC-SHA256 | `v0:ts:body` | 5 min | Prefix `v0:` literal in HMAC input. Slack's "URL verification" challenge requires echoing `challenge` field once. |
| **Linear** | `Linear-Signature` | HMAC-SHA256 | `body` only | none | Dedup by `data.id` from payload. |
| **Discord** | `X-Signature-Ed25519` + `X-Signature-Timestamp` | Ed25519 | `ts.body` | none in header | NOT HMAC — use `nacl.sign.detached.verify` against application's public key. Interaction `PING` (type 1) must echo `PONG` (type 1) in <3s. |
| **Twilio** | `X-Twilio-Signature` | HMAC-SHA1 | URL + sorted `body` params | none | Concatenate full URL + `key=value` pairs sorted by key. Use `twilio.validateRequest`. |
| **Generic internal** | `X-Webhook-{Id,Timestamp,Signature}` | HMAC-SHA256 | `ts.body` | 5 min | This recipe's default. |

Three rules from the table:

- **Use the provider SDK when one exists** (`stripe.webhooks.constructEvent`,
  `@octokit/webhooks`, `twilio.validateRequest`) — they encode quirks
  you'll otherwise rediscover via outage. Fall back to manual HMAC only
  for self-host or tiny providers.
- **Header-name case is wire-spec, but Node 24 lowercases on read** —
  always read via lowercase (`request.headers.get('x-stripe-signature')`).
- **Discord is Ed25519, not HMAC** — and demands a `PONG` echo for
  interaction-type 1 within 3 seconds. Don't apply the HMAC pattern
  blindly.

## Stripe variant — provider SDK

```ts
// src/routes/api/webhooks/stripe/+server.ts
import { error, json, type RequestHandler } from '@sveltejs/kit';
import Stripe from 'stripe';
import { env } from '$env/dynamic/private';
import { dedupOrThrow } from '$lib/webhooks/dedup';
import { enqueue } from '$lib/queue';

const stripe = new Stripe(env.STRIPE_SECRET_KEY);

export const POST: RequestHandler = async ({ request }) => {
  const sig = request.headers.get('stripe-signature');
  if (!sig) throw error(400, 'missing_signature');
  const raw = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    throw error(401, 'signature_invalid');
  }

  await dedupOrThrow('stripe', event.id);
  await enqueue('stripe.process', { eventId: event.id, type: event.type, data: event.data });
  return json({ received: true }, { status: 202 });
};
```

`stripe.webhooks.constructEvent` does HMAC verify + replay-window
check + payload parse in one call. Three Stripe specifics:

- **Per-endpoint secret, not account secret** — Stripe issues a
  distinct `whsec_*` per webhook endpoint; rotate per-endpoint without
  affecting others.
- **`event.type` is the discriminator** — switch on it in the queue
  worker; ignore unknown types (Stripe adds new ones — defaulting to
  500 will trigger their retry).
- **`livemode` flag** — every event includes it. Test-mode webhooks
  must hit a separate endpoint or your dedup table will have collisions
  between test+live event IDs.

## Dedup store

```ts
// src/lib/webhooks/dedup.ts
import { error } from '@sveltejs/kit';
import { db } from '$lib/db';

const DEDUP_TTL_DAYS = 7;

export async function dedupOrThrow(provider: string, eventId: string): Promise<void> {
  const inserted = await db.insertInto('webhook_events')
    .values({ provider, event_id: eventId, received_at: new Date() })
    .onConflict((oc) => oc.columns(['provider', 'event_id']).doNothing())
    .executeTakeFirst();

  if (Number(inserted.numInsertedOrUpdatedRows) === 0) {
    throw error(200, 'duplicate'); // 200 — provider treats 4xx/5xx as retry trigger
  }

  await db.deleteFrom('webhook_events').where('received_at', '<', new Date(Date.now() - DEDUP_TTL_DAYS * 86400 * 1000)).execute();
}
```

Three dedup rules:

- **Composite unique key `(provider, event_id)`** — different providers
  may emit overlapping IDs; provider-prefix prevents false-positive
  dedup.
- **Return 2xx on duplicate** — providers treat 4xx/5xx as retry
  trigger; returning 4xx on dedup-rejection causes thundering retries.
- **TTL the dedup table** — providers retry within minutes-to-hours,
  not weeks; 7-day window is generous. Beyond that, dropping rows is
  safe (replay older than 7d hits the timestamp-window check first
  anyway, when the provider includes timestamp in HMAC).

## Async work behind 2xx ack

```ts
// src/lib/queue/workers/webhook-process.ts
import { z } from 'zod';

const StripeChargeSucceeded = z.object({
  type: z.literal('charge.succeeded'),
  data: z.object({ object: z.object({ id: z.string(), amount: z.number().int().positive() }) }),
});

export async function processWebhook(job: { provider: string; eventId: string; payload: unknown }) {
  if (job.provider !== 'stripe') return;
  const parsed = StripeChargeSucceeded.safeParse(job.payload);
  if (!parsed.success) return;
  await markChargeSucceeded(parsed.data.data.object.id, parsed.data.data.object.amount);
}
```

Two queue rules:

- **Worker is idempotent** — dedup-on-receive prevents most duplicates,
  but the worker is the second line of defence (stuck job re-runs are
  the classic edge case). The business-logic call (`markChargeSucceeded`)
  must be idempotent or wrapped in a transaction with a unique
  constraint on `(provider, event_id, business_action)`.
- **Schema parse inside the worker** — receiver only needs to verify
  the signature; parse-and-act lives behind the queue. This decouples
  schema-evolution failures from receiver availability (a new event
  field doesn't 5xx the receiver and trigger retries — it logs in the
  worker).

## Observability

```ts
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('webhooks');

const span = tracer.startSpan('webhook.receive', {
  attributes: {
    'webhook.provider': params.provider,
    'webhook.event_id': eventId,
    'webhook.signature_version': 'v1',
  },
});
try {
  // ... verify + dedup + enqueue ...
  span.setAttribute('webhook.outcome', 'enqueued');
} finally {
  span.end();
}
```

Per [observability.md](observability.md):

- **`webhook.provider` is bounded** — span attribute ok.
- **`webhook.event_id` is per-event** — span attribute ok (traces are
  not indexed for cardinality), **never** as a metric label or log
  attribute.
- **`webhook.outcome` enum** — `enqueued` / `duplicate` /
  `signature_mismatch` / `outside_window` / `malformed` — drive a
  receive-rate dashboard from this.

## Failure-response shape

```ts
// src/lib/webhooks/problem.ts
export function webhookProblem(status: number, type: string, title: string) {
  return new Response(JSON.stringify({
    type: `urn:sveltesentio:webhook:${type}`,
    title,
    status,
  }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });
}
```

Per [http-client.md](http-client.md): RFC 9457 problem+json for the
4xx/5xx body. Provider-side parsing is rare (most providers just check
status code) but consistency with the rest of the framework matters.
**Never** include the expected signature, timestamp window bounds, or
event-ID format in the response — those are oracle leaks.

## Local development — provider tunnel + signature replay

```text
Stripe   → `stripe listen --forward-to localhost:5173/api/webhooks/stripe` (issues a temp whsec_*)
GitHub   → `smee.io` proxy or `gh webhook forward`
Slack    → ngrok tunnel + manual subscription URL update
Generic  → use Vitest with stored example payload + recomputed signature
```

Two dev rules:

- **Different signing secret per environment** (`whsec_test_*` for dev,
  `whsec_live_*` for prod) — leaking the dev secret is annoying;
  leaking prod is "all webhook handlers compromised". Never reuse.
- **Don't disable signature verification in dev** — even temporarily.
  The path that disables verification ships to prod sooner or later.
  Use the provider's dev-mode signature (Stripe CLI emits one) or
  Vitest with a sample payload.

## Testing

```ts
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';

describe('webhook receiver', () => {
  const secret = 'test-secret';
  function sign(ts: number, body: string): string {
    return 'v1=' + createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  }

  it('rejects timestamp outside window', async () => {
    const ts = Math.floor(Date.now() / 1000) - 1000;
    const body = JSON.stringify({ id: 'evt_1' });
    const res = await POST({ request: makeReq(body, { ts, sig: sign(ts, body) }) });
    expect(res.status).toBe(400);
  });

  it('rejects signature mismatch', async () => {
    const ts = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ id: 'evt_1' });
    const res = await POST({ request: makeReq(body, { ts, sig: 'v1=deadbeef'.padEnd(67, '0') }) });
    expect(res.status).toBe(401);
  });

  it('dedups duplicate event IDs', async () => {
    const ts = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ id: 'evt_1' });
    await POST({ request: makeReq(body, { ts, sig: sign(ts, body) }) });
    const res = await POST({ request: makeReq(body, { ts, sig: sign(ts, body) }) });
    expect(res.status).toBe(200); // 200 not 4xx — dedup is success
  });
});
```

Three test rules:

- **Always test the timestamp-window rejection** — getting it wrong (off
  by an hour) silently disables replay protection.
- **Test the dedup return code** — 200 not 4xx is critical;
  inverting that triggers retry storms in prod.
- **Don't test the SDK** — `stripe.webhooks.constructEvent` is Stripe's
  problem; test your dispatch + dedup + enqueue logic with the SDK
  mocked.

## Anti-patterns

- **Verifying signature on parsed JSON** — `JSON.parse(raw)` then
  `JSON.stringify(...)` re-serialises with different whitespace; HMAC
  fails for legitimate requests.
- **`===` for signature comparison** — leaks signature bytes via
  timing; `timingSafeEqual` always.
- **Skipping length-check before `timingSafeEqual`** — throws on
  unequal length; explicit check first.
- **No timestamp in HMAC input** — replay protection impossible;
  attacker captures one valid request and re-sends forever.
- **Replay window > 10 minutes** — clock skew rarely exceeds 5 min;
  wider windows widen the replay window for stolen requests.
- **No dedup table** — providers retry on 4xx/5xx **and** on network
  flakes; at-least-once delivery means duplicate processing without
  dedup.
- **Dedup keyed on payload hash, not event ID** — payload variations
  (timestamps inside payload, etc.) defeat dedup; provider-issued
  event ID is the canonical key.
- **4xx on duplicate** — provider treats as retry trigger; return 2xx
  with "already processed" semantics.
- **Synchronous business logic in receiver** — provider timeout (5-30s)
  + slow DB call = retry storm; ack 2xx fast, work in queue.
- **Logging the request body** — payloads carry PII (customer email,
  charge amount, full payment metadata); structured logs with bounded
  attributes only.
- **Logging the signature** — defeats secret rotation; signature is as
  sensitive as the secret it derives from.
- **One endpoint for test + live mode** (Stripe-style) — dedup
  collisions; `livemode` flag inversion ships test logic to prod.
- **Disabling verification "temporarily" in dev** — the disable path
  ships to prod; use provider tunnel + dev secret instead.
- **Sharing the webhook secret between environments** — leaked dev
  secret = prod-receivable forgeries; per-env secret with per-env
  endpoint URL.
- **Sharing the webhook secret across providers** — Stripe leak does
  not become a Linear leak; per-provider secret.
- **Hardcoding the secret in the repo** — `.env` + secret manager;
  leaked secret rotates immediately.
- **Returning verbose error bodies** ("expected v1=abc, got v1=def") —
  oracle for signature enumeration; generic 401 / 400.
- **Status 200 on signature failure** — provider treats success as
  "delivered, won't retry"; failure must be 4xx or provider keeps
  re-sending forever (your endpoint becomes a bug magnet).
- **Status 5xx on signature failure** — triggers retry storm; 4xx is
  "won't accept, don't retry".
- **No span attribute for outcome** — observability blind spot; can't
  distinguish "rejected 100 forgeries" from "rejected 100 legitimate
  due to clock skew" without `webhook.outcome` enum.
- **`event.type` switch with no default branch** — new event types
  silently 500 → retry storm; default branch logs + 2xx-acks unknown
  events.
- **Long-running queue worker without idempotency** — receiver dedup
  catches network-level duplicates; worker idempotency catches stuck-job
  re-runs. Both are required.

## References

- [RFC 9421 — HTTP Message Signatures](https://datatracker.ietf.org/doc/html/rfc9421)
- [Stripe — Webhook signatures](https://docs.stripe.com/webhooks/signatures)
- [GitHub — Securing webhooks](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)
- [Slack — Verifying requests](https://api.slack.com/authentication/verifying-requests-from-slack)
- [Discord — Verifying interactions](https://discord.com/developers/docs/interactions/overview#setting-up-an-endpoint-validating-security-request-headers)
- [OWASP — Webhook Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Webhook_Security_Cheat_Sheet.html)
- [`crypto.timingSafeEqual`](https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b)
