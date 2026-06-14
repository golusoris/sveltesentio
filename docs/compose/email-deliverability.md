# Email deliverability — SPF/DKIM/DMARC + List-Unsubscribe-Post + bounces + suppression

Transactional emails are useless if they don't arrive. Deliverability
is 80% DNS configuration (SPF/DKIM/DMARC), 15% operational discipline
(bounce handling, suppression list, complaint loops), and 5%
template hygiene (plain-text fallback, `List-Unsubscribe` headers).
This recipe is the authoritative contract for the sveltesentio
stack: **sending provider (Postmark default / SES escape) +
authenticated domains + bounce/complaint webhook → suppression list
+ RFC 8058 one-click unsubscribe + per-template send rate monitors**.

Per [principles.md §2.2](../principles.md) (OWASP ASVS L2 V8 —
communication security; email is a trust channel), the posture is:
**authenticated from-domain with DMARC `p=reject` enforced**, **every
outbound send check suppression list first** (bounced / unsubscribed
/ spam-complained), **`List-Unsubscribe-Post` header for one-click**,
**template content goes through existing [structured-emails.md](structured-emails.md)
pipeline (mjml-svelte + plain-text fallback)**, and **bounce/complaint
webhooks are idempotent + HMAC-verified**.

## Related

- [structured-emails.md](structured-emails.md) — mjml-svelte template
  authoring, plain-text fallback contract, transactional-vs-marketing
  separation.
- [webhooks.md](webhooks.md) — inbound bounce/complaint webhook from
  Postmark/SES/Resend uses the shared HMAC-verified receiver pattern.
- [audit-log.md](audit-log.md) — every send + bounce + unsubscribe +
  complaint is an audit row for compliance + customer-success.
- [rate-limiting.md](rate-limiting.md) — per-user send-rate caps
  (e.g. 3 password-reset emails per hour) prevent bomb/spam abuse.
- [consent-management.md](consent-management.md) — marketing-category
  opt-in required for marketing sends; transactional exempt.
- [observability.md](observability.md) — bounded `email.provider`,
  `email.template`, `email.status` labels; bounce-rate per-template
  gauge.
- [cron-jobs.md](cron-jobs.md) — daily bounce-rate digest;
  suppression-list pruning (bounces older than 180 days retryable).
- [service-limits.md](service-limits.md) — per-tenant email quota
  (marketing sends cap by plan).
- [onboarding.md](onboarding.md) — welcome email + re-engagement on
  `onboarding.abandoned`.
- [permissions.md](permissions.md) — only admins see the raw
  suppression list; users see only their own status.
- [principles.md §2.2](../principles.md) — OWASP ASVS L2 V8.

## What "deliverability" actually means

```text
Sent            → provider accepted the API call
Delivered       → recipient mailbox accepted the message
Bounced (hard)  → permanent failure (invalid address, domain gone)
Bounced (soft)  → transient failure (full mailbox, server timeout)
Deferred        → retry-later (usually greylisting)
Complained      → recipient hit "mark as spam"
Unsubscribed    → recipient hit `List-Unsubscribe`
Opened          → TRACKING PIXEL (unreliable; blocked by many clients)
Clicked         → redirect-link tracking (unreliable; blocked, prefetched)
```

**Three measurement rules:**

1. **`Delivered` is the success metric, not `Sent`.** A 100% send
   rate with a 30% bounce rate means 30% of users never got the
   email. Dashboards read `delivered / sent`.
2. **Opens and clicks are not reliable.** Apple Mail Privacy
   Protection prefetches every tracking pixel; Gmail sometimes
   does too. Trust opens for aggregate trends, never for per-
   user "did they see it?" questions.
3. **Bounce rate >5% is a deliverability emergency.** Mailbox
   providers start greylisting or blocking after sustained
   poor reputation. Alert at 2%, page at 5%.

## Sending-provider decision matrix

| Provider | Use when | Avoid when |
|---|---|---|
| **Postmark** (DEFAULT) | Transactional only; clean reputation; straightforward API | Marketing sends (separate product: Postmark Broadcasts) |
| **AWS SES** (ESCAPE high-volume) | >1M/month transactional; AWS-integrated; cost-sensitive | Small team (deliverability tuning is on you) |
| **Resend** | Developer-friendly API; React-email ecosystem (we use mjml-svelte) | — (it's fine; Postmark is more mature) |
| **SendGrid** | Legacy integrations only | New projects — reputation has dipped |
| **Mailgun** | — | New projects; prefer Postmark/SES/Resend |
| **Your own SMTP / Postfix** | Never for new sends | ALWAYS (IP reputation bootstrapping is a year-long project) |

**Three provider rules:**

1. **Separate transactional and marketing IPs.** A marketing spam
   complaint on shared IP poisons password-reset delivery. Use
   dedicated IPs + subdomains:
   `noreply@mail.example.com` (transactional),
   `hello@news.example.com` (marketing).
2. **Never self-host SMTP for outbound.** IP reputation
   bootstrapping takes months, blocks are silent, and you lose
   bounce-webhook infrastructure.
3. **Use provider's bounce-webhook** instead of parsing DSN
   messages. Providers normalize bounce classifications into
   `HardBounce` / `SoftBounce` / `SpamComplaint` / `Transient`;
   you don't want to parse RFC 3464 by hand.

## DNS configuration — the non-negotiable baseline

### SPF

```text
mail.example.com.  TXT  "v=spf1 include:spf.mtasv.net -all"
```

Three rules:

1. **One TXT record per domain** (multi-record SPF is invalid).
2. **`-all` (hardfail), not `~all`.** Softfail means receivers may
   accept; you want strict failure so spoofing fails cleanly.
3. **`include:` the provider's SPF host** — `spf.mtasv.net`
   (Postmark), `amazonses.com` (SES), `_spf.resend.com` (Resend).

### DKIM

```text
<selector>._domainkey.mail.example.com.  TXT  "v=DKIM1; k=rsa; p=MIGf..."
```

Five rules:

1. **Selector per-provider.** Postmark gives you one; SES gives
   three; rotating keys means new selector. Never reuse across
   providers.
2. **2048-bit keys minimum.** 1024-bit is legacy; mailbox providers
   increasingly weigh 2048+ higher.
3. **Publish both keys during rotation.** Old and new live in DNS
   concurrently for 7 days before removing the old.
4. **Aligned domain.** DKIM `d=` domain matches `From:` domain for
   DMARC alignment — otherwise DMARC fails even with valid DKIM.
5. **Never share a DKIM key across environments.** Prod and
   staging have separate selectors.

### DMARC

```text
_dmarc.example.com.  TXT  "v=DMARC1; p=reject; rua=mailto:dmarc@example.com; ruf=mailto:dmarc@example.com; fo=1; pct=100; adkim=s; aspf=s"
```

**Seven DMARC rules:**

1. **Start with `p=none` for 2-4 weeks**, collect aggregate reports,
   identify legitimate senders you missed, THEN move to `p=quarantine`,
   THEN to `p=reject`. Never skip to `reject` on day one.
2. **`p=reject` is the target, not `p=quarantine`.** Quarantine lands
   in spam folder; reject drops entirely. Attackers prefer quarantine
   (user may check spam and trust it).
3. **`rua=` for aggregate reports**, `ruf=` for forensic. Use a
   mailbox you actually monitor or a DMARC-processing service
   (dmarc.report, Valimail, Dmarcian).
4. **`adkim=s; aspf=s`** (strict alignment) not `r` (relaxed). Strict
   means the `From:` domain must exactly match the authenticated
   domain, not merely be a subdomain — tighter.
5. **`pct=100` in prod.** Lower percentages (`pct=10`) are for
   gradual rollout during `p=quarantine` phase, never during
   `p=reject`.
6. **`fo=1`** — forensic reports on any failure (useful for debug).
   Don't enable forensic in high-volume environments (PII exposure).
7. **BIMI is optional polish.** Only meaningful after `p=reject`
   enforced and VMC certificate purchased. Not a priority.

### MTA-STS + TLS-RPT (optional but recommended)

```text
_mta-sts.example.com.  TXT  "v=STSv1; id=20260418T120000;"
```

Hosted policy at `https://mta-sts.example.com/.well-known/mta-sts.txt`:

```text
version: STSv1
mode: enforce
mx: *.example.com
max_age: 604800
```

Two rules:

1. **MTA-STS enforces TLS on inbound.** Prevents downgrade attacks
   on recipients sending email *to* your domain.
2. **Start with `mode: testing`, move to `enforce` after 2 weeks.**
   Monitor TLS-RPT reports for misconfigured receiving MX servers.

## Shape

```text
src/lib/email/
├── send.ts                 sendEmail() with suppression + audit + rate-limit
├── suppression.ts          isSuppressed / addSuppression / removeSuppression
├── templates/              mjml-svelte templates (see structured-emails.md)
└── schemas.ts              EmailTemplate enum + EmailEvent schema

src/routes/api/webhooks/email/+server.ts
                            HMAC-verified inbound bounce/complaint webhook

src/routes/unsubscribe/+server.ts
                            RFC 8058 one-click POST handler

supabase/migrations/NNN_email.sql
                            email_suppressions + email_events tables
```

## Reference pattern

### 1. `sendEmail()` — the gated send

```typescript
// src/lib/email/send.ts
import { Postmark } from 'postmark';
import { POSTMARK_TOKEN } from '$env/static/private';
import { isSuppressed, recordEmailEvent } from './suppression';
import { renderTemplate } from './templates';
import { checkRateLimit } from '$lib/rate-limiting';
import type { EmailTemplate } from './schemas';

const postmark = new Postmark.ServerClient(POSTMARK_TOKEN);

interface SendOptions {
  to: string;
  template: EmailTemplate;
  data: Record<string, unknown>;
  userId: string;
  category: 'transactional' | 'marketing';
  correlationId: string;
}

export async function sendEmail(opts: SendOptions): Promise<{ sent: boolean; reason?: string }> {
  if (await isSuppressed(opts.to, opts.category)) {
    await recordEmailEvent({ ...opts, action: 'suppressed', reason: 'suppression_list' });
    return { sent: false, reason: 'suppression_list' };
  }

  const rl = await checkRateLimit({
    bucket: `email:${opts.userId}:${opts.template}`,
    limit: 10,
    windowSeconds: 3600,
  });
  if (!rl.allowed) {
    await recordEmailEvent({ ...opts, action: 'suppressed', reason: 'rate_limit' });
    return { sent: false, reason: 'rate_limit' };
  }

  const rendered = await renderTemplate(opts.template, opts.data);

  const listUnsubUrl = `https://${PUBLIC_DOMAIN}/unsubscribe?token=${signUnsubToken(opts.to, opts.category)}`;

  const res = await postmark.sendEmail({
    From: fromAddress(opts.category),
    To: opts.to,
    Subject: rendered.subject,
    HtmlBody: rendered.html,
    TextBody: rendered.text,
    MessageStream: opts.category === 'transactional' ? 'outbound' : 'broadcast',
    Headers: [
      { Name: 'List-Unsubscribe', Value: `<${listUnsubUrl}>, <mailto:unsub@${PUBLIC_DOMAIN}?subject=unsubscribe&body=${opts.to}>` },
      { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
      { Name: 'X-Template', Value: opts.template },
      { Name: 'X-Correlation-Id', Value: opts.correlationId },
    ],
    Metadata: { userId: opts.userId, template: opts.template, correlationId: opts.correlationId },
  });

  await recordEmailEvent({
    ...opts,
    action: 'sent',
    providerId: res.MessageID,
  });

  return { sent: true };
}

function fromAddress(category: 'transactional' | 'marketing'): string {
  return category === 'transactional'
    ? `noreply@mail.${PUBLIC_DOMAIN}`
    : `hello@news.${PUBLIC_DOMAIN}`;
}
```

**Seven send rules:**

1. **Suppression check first, always.** Unsubscribed / bounced /
   complained recipients never receive sends — regardless of
   transactional vs marketing (transactional can suppress on hard
   bounce only; unsubscribe only applies to marketing).
2. **Rate-limit per-user-per-template.** 10 sends/hour of the
   `password_reset` template stops a credential-stuffing attacker
   from spamming your user. Bucket-per-template via
   [rate-limiting.md](rate-limiting.md).
3. **Separate `MessageStream` for transactional vs marketing.**
   Postmark/SES route through different IPs + reputation pools.
4. **`List-Unsubscribe` + `List-Unsubscribe-Post: One-Click`**
   (RFC 8058) — Gmail's "unsubscribe" button requires both. The
   `mailto:` is the fallback; the HTTPS URL is the modern path.
5. **Token-signed unsubscribe URL.** HMAC the `(email, category,
   timestamp)` — prevents enumeration attacks; expires after N
   days.
6. **`X-Correlation-Id` on every send.** Threads through webhook
   callbacks for OTel correlation. Same UUIDv7 convention as
   [observability.md](observability.md).
7. **Audit *before* send for suppression/rate-limit, *after* send
   for provider-sent.** Order matters: a suppression-skipped
   send still needs an audit row (for customer-success visibility:
   "why didn't I receive the email?").

### 2. Suppression list

```sql
CREATE TABLE email_suppressions (
  email          TEXT NOT NULL,
  category       TEXT NOT NULL CHECK (category IN ('transactional', 'marketing', 'all')),
  reason         TEXT NOT NULL CHECK (reason IN ('hard_bounce', 'soft_bounce', 'complaint', 'unsubscribe', 'manual')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata       JSONB,

  PRIMARY KEY (email, category)
);

CREATE INDEX email_suppressions_email_idx ON email_suppressions (email);
CREATE INDEX email_suppressions_created_idx ON email_suppressions (created_at DESC);
```

```typescript
// src/lib/email/suppression.ts
import { db } from '$lib/db';

export async function isSuppressed(
  email: string,
  category: 'transactional' | 'marketing',
): Promise<boolean> {
  const row = await db.oneOrNone(
    `SELECT 1 FROM email_suppressions
      WHERE email = $1
        AND (category = $2 OR category = 'all')
        AND (reason != 'soft_bounce' OR created_at > now() - interval '24 hours')`,
    [email.toLowerCase(), category],
  );
  return row !== null;
}

export async function addSuppression(
  email: string,
  category: 'transactional' | 'marketing' | 'all',
  reason: 'hard_bounce' | 'soft_bounce' | 'complaint' | 'unsubscribe' | 'manual',
  metadata?: Record<string, unknown>,
): Promise<void> {
  await db.none(
    `INSERT INTO email_suppressions (email, category, reason, metadata)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email, category) DO UPDATE SET reason = EXCLUDED.reason,
                                                  metadata = EXCLUDED.metadata,
                                                  created_at = now()`,
    [email.toLowerCase(), category, reason, metadata ?? null],
  );
}
```

**Six suppression rules:**

1. **Emails are lowercase-normalized** on write and read.
   Otherwise `User@Example.com` and `user@example.com` live as
   separate rows and one receives what the other unsubscribed
   from.
2. **Three categories: `transactional` / `marketing` / `all`.**
   Hard-bounce on an invalid address suppresses `all`; complaint
   on a marketing send suppresses `marketing` only (they still
   need password-reset).
3. **Soft bounce is transient — 24h expiry.** Mailbox-full
   recovers. Hard bounce is permanent — never expires (until
   manual-review unsuppression).
4. **Complaint suppresses `all`.** A user who hit "mark as spam"
   should never receive *anything* — even transactional — unless
   they explicitly re-opt-in. Sending more after complaint is an
   ISP-reputation disaster.
5. **Unsubscribe via List-Unsubscribe suppresses `marketing`
   only.** Transactional continues (they still need to log in).
   Unsubscribe page must explicitly explain this distinction.
6. **Manual unsuppression requires admin role.** A customer-
   success rep removing someone from suppression because "they
   said they want the email" is a formal action — logged to
   audit, reason captured.

### 3. Inbound bounce/complaint webhook

```typescript
// src/routes/api/webhooks/email/+server.ts
import type { RequestHandler } from './$types';
import { verifyWebhookSignature } from '$lib/webhooks';
import { addSuppression } from '$lib/email/suppression';
import { recordEmailEvent } from '$lib/email/events';
import { POSTMARK_WEBHOOK_SECRET } from '$env/static/private';
import { z } from 'zod';

const PostmarkBounceEvent = z.object({
  RecordType: z.enum(['Bounce', 'SpamComplaint', 'Delivery', 'Open', 'Click', 'SubscriptionChange']),
  Email: z.string().email(),
  Type: z.string().optional(),
  TypeCode: z.number().optional(),
  MessageID: z.string().optional(),
  Metadata: z.record(z.string()).optional(),
});

export const POST: RequestHandler = async ({ request }) => {
  const raw = await request.text();
  verifyWebhookSignature(raw, request.headers, POSTMARK_WEBHOOK_SECRET);

  const event = PostmarkBounceEvent.parse(JSON.parse(raw));

  if (event.RecordType === 'Bounce') {
    const isHard = event.TypeCode === 1 || event.Type === 'HardBounce';
    await addSuppression(
      event.Email,
      'all',
      isHard ? 'hard_bounce' : 'soft_bounce',
      { providerMessageId: event.MessageID, typeCode: event.TypeCode },
    );
  } else if (event.RecordType === 'SpamComplaint') {
    await addSuppression(event.Email, 'all', 'complaint', {
      providerMessageId: event.MessageID,
    });
  }

  await recordEmailEvent({
    email: event.Email,
    action: event.RecordType.toLowerCase() as never,
    providerId: event.MessageID,
    correlationId: event.Metadata?.correlationId ?? null,
  });

  return new Response(null, { status: 200 });
};
```

**Five webhook rules:**

1. **HMAC-verify every webhook.** Providers sign with account
   tokens; verify before parsing body. Use the shared
   [webhooks.md](webhooks.md) verifier.
2. **Idempotent on retry.** Providers retry on non-2xx; our
   handler is `INSERT ... ON CONFLICT DO UPDATE` so duplicate
   events are no-ops.
3. **Always 200 on parsed-known events** — even ones we don't
   act on (Opens, Clicks). Non-2xx triggers exponential retry
   and the event queue backs up.
4. **Correlate via `Metadata.correlationId`** stored at send
   time. Links provider event → our audit row → our OTel span.
5. **Don't block on webhook processing.** If suppression DB
   write takes >5s, the provider times out. Return 200 fast;
   queue slow work separately if needed.

### 4. RFC 8058 one-click unsubscribe

```typescript
// src/routes/unsubscribe/+server.ts
import type { RequestHandler } from './$types';
import { verifyUnsubToken } from '$lib/email/tokens';
import { addSuppression } from '$lib/email/suppression';
import { recordEmailEvent } from '$lib/email/events';

export const POST: RequestHandler = async ({ request, url }) => {
  const token = url.searchParams.get('token');
  if (!token) return new Response('missing token', { status: 400 });

  const parsed = verifyUnsubToken(token);
  if (!parsed) return new Response('invalid token', { status: 400 });

  await addSuppression(parsed.email, parsed.category, 'unsubscribe');
  await recordEmailEvent({
    email: parsed.email,
    action: 'unsubscribed',
    category: parsed.category,
  });

  return new Response(null, { status: 204 });
};

export const GET: RequestHandler = async ({ url }) => {
  const token = url.searchParams.get('token');
  if (!token) return new Response('missing token', { status: 400 });
  const parsed = verifyUnsubToken(token);
  if (!parsed) return new Response('invalid token', { status: 400 });

  return new Response(renderUnsubConfirmPage(parsed), {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
};
```

**Six unsubscribe rules:**

1. **POST for RFC 8058 one-click.** Gmail sends `POST` with body
   `List-Unsubscribe=One-Click`. Must return 2xx with no user
   interaction needed.
2. **GET for mail clients that follow the link.** Renders a
   confirmation page with a button — human-visible UX.
3. **Token-based, never email-in-URL.** `?email=user@x.com`
   lets anyone with the URL unsubscribe anyone. Signed token
   with expiry.
4. **Idempotent.** Clicking unsubscribe twice is the same as
   once.
5. **Don't require login.** Unsubscribe must work for someone
   who never signed in or has forgotten their password.
6. **Resubscribe requires opt-in action.** The confirmation page
   offers a re-subscribe link; it's a full opt-in flow, not
   just inverting the suppression row.

## Observability

```text
Attribute            Values
──────────────────────────────────────────────────────
email.provider       'postmark' | 'ses' | 'resend'
email.template       EmailTemplate enum (bounded)
email.category       'transactional' | 'marketing'
email.status         'sent' | 'delivered' | 'bounced' | 'complained' | 'unsubscribed' | 'suppressed'
email.bounce_type    'hard' | 'soft' | null

Metrics
──────────────────────────────────────────────────────
email.send.count             counter, labels: template, category, status
email.delivery.rate          gauge (delivered/sent per template)
email.bounce.rate            gauge (bounced/sent per template)
email.complaint.rate         gauge (complained/sent per template)
email.suppression.size       gauge (total rows in suppression)
```

**Five observability rules:**

1. **`email.template` bounded enum.** Never raw subject line.
   Subject lines are unbounded (A/B variants, personalization);
   templates are finite.
2. **Bounce rate >2% per-template alert; >5% page.** Threshold
   per template because `password_reset` bounces differently
   than `newsletter` (higher, since typos in signup addresses).
3. **Track complaint rate separately** — it's the reputation
   killer. >0.3% complaint rate is Gmail's documented threshold
   for penalties.
4. **Suppression-list size as a gauge** — rapid growth indicates
   a delivery issue (wrong-list, bug in send-code).
5. **`correlationId` span attribute**, never metric label. Same
   cardinality rule as everywhere.

## Daily cron — bounce digest + soft-bounce expiry

```typescript
// src/routes/api/cron/email-health/+server.ts
import { withCronRun } from '../_shared/runner';
import { verifyCronRequest } from '../_shared/authn';
import { db } from '$lib/db';
import { subDays } from 'date-fns';
import { now } from '$lib/clock';

export const POST: RequestHandler = async ({ request }) => {
  verifyCronRequest(request);

  return withCronRun('email-health', async () => {
    const removed = await db.result(
      `DELETE FROM email_suppressions
         WHERE reason = 'soft_bounce'
           AND created_at < $1`,
      [subDays(now(), 1)],
    );

    const retryable = await db.result(
      `DELETE FROM email_suppressions
         WHERE reason = 'hard_bounce'
           AND created_at < $1`,
      [subDays(now(), 180)],
    );

    return {
      processed: (removed.rowCount ?? 0) + (retryable.rowCount ?? 0),
      skipped: 0,
      details: {
        softBounceExpired: removed.rowCount ?? 0,
        hardBounceRetryable: retryable.rowCount ?? 0,
      },
    };
  });
};
```

**Three cron rules:**

1. **Soft-bounce expires after 24h.** User's inbox was full;
   probably not full anymore.
2. **Hard-bounce "forgetting" after 180 days is optional.**
   Addresses can become valid again (domain handover). Only
   re-attempt sends for high-value templates (password reset),
   not marketing.
3. **Complaint and unsubscribe never expire.** Those are
   explicit user signals; re-adding them would be a CAN-SPAM
   / GDPR violation.

## Testing — three lanes

```typescript
it('suppresses hard-bounce email permanently', async () => {
  await addSuppression('bad@example.com', 'all', 'hard_bounce');
  expect(await isSuppressed('bad@example.com', 'transactional')).toBe(true);
  expect(await isSuppressed('bad@example.com', 'marketing')).toBe(true);
});

it('soft-bounce expires after 24h', async () => {
  vi.setSystemTime(new Date('2026-04-18T00:00:00Z'));
  await addSuppression('slow@example.com', 'all', 'soft_bounce');
  expect(await isSuppressed('slow@example.com', 'transactional')).toBe(true);

  vi.setSystemTime(new Date('2026-04-19T01:00:00Z'));
  expect(await isSuppressed('slow@example.com', 'transactional')).toBe(false);
});

it('POST /unsubscribe with valid token returns 204 and suppresses', async () => {
  const token = signUnsubToken('user@x.com', 'marketing');
  const res = await app.request(`/unsubscribe?token=${token}`, { method: 'POST' });
  expect(res.status).toBe(204);
  expect(await isSuppressed('user@x.com', 'marketing')).toBe(true);
});
```

**Four test rules:**

1. **Suppression-matrix table-test.** All `(category, reason)`
   combinations; regressions here cause reputation damage that
   takes weeks to recover.
2. **Clock-controlled soft-bounce expiry.** Easy to break when
   refactoring; hard to notice until users complain about
   missing emails.
3. **Provider webhook fixtures.** Postmark / SES JSON payloads
   from their docs, committed to tests. Parse them with the
   real handler.
4. **DMARC/DKIM/SPF smoke lane.** A staging-env cron that sends
   itself an email and verifies SPF/DKIM/DMARC headers via
   `check-auth@verifier.port25.com` or similar. Catches DNS
   regressions.

## Anti-patterns

1. **`p=none` permanently.** You get aggregate reports but no
   protection; spoofers can send as-you all day.
2. **No suppression check before send.** Send-then-get-bounce
   cycles burn reputation fast.
3. **Unsubscribe that requires login.** Violates RFC 8058 and
   CAN-SPAM; Gmail stops honoring your one-click button.
4. **Shared IP for transactional + marketing.** One marketing
   complaint takes down password-reset delivery.
5. **Parsing bounce DSN messages yourself.** Providers already
   normalize; you lose time and get it wrong.
6. **Ignoring complaints.** Even 0.5% sustained complaint rate
   → Gmail penalty box → months of degraded delivery.
7. **Tracking pixel in transactional email.** Apple MPP and
   corporate mail gateways treat tracking-pixels as phishing
   signal. Plus: opens aren't reliable anyway.
8. **Not rate-limiting password-reset sends.** Attacker floods
   a victim's inbox via repeated reset requests; mailbox
   provider throttles you.
9. **Mixing transactional and marketing content in one email.**
   "Here's your receipt + here's our newsletter" violates
   CAN-SPAM — transactional exemption requires >50% trans
   content.
10. **Email-address in unsubscribe URL unsigned.** Enumeration
    attack: scrape email list by iterating URLs.
11. **Keeping rejected emails in the list.** Sending to the
    same invalid address daily burns reputation. Suppress on
    first hard bounce.
12. **No DMARC-reports monitoring.** You deploy something that
    breaks alignment, don't find out for weeks, users see
    `via amazonses.com` warnings.
13. **`From:` address that nobody reads.** `noreply@...` is
    fine; but the domain must be able to *receive* bounces
    (MX records + a processing address). Otherwise providers
    treat you as suspicious.
14. **Batching 10k sends in one API call.** If one address in
    the batch is bad, the error surfaces at batch-level and
    you can't attribute. Send individually (providers are fine
    with per-send rates).
15. **Manually editing the suppression list.** Every
    add/remove via code path; manual DB edits skip audit and
    leave you unable to answer "why was this email blocked?".

## References

- [ADR-0019 — structured errors](../adr/0019-structured-errors.md) —
  send-failures flow through ProblemError.
- [ADR-0023 — observability](../adr/0023-observability.md) — bounded
  `email.template` + `email.status` labels.
- [structured-emails.md](structured-emails.md) — template authoring.
- [webhooks.md](webhooks.md) — HMAC-verified inbound pattern.
- [audit-log.md](audit-log.md) — send + bounce + unsubscribe audit.
- [rate-limiting.md](rate-limiting.md) — per-user send caps.
- [consent-management.md](consent-management.md) — marketing opt-in.
- [cron-jobs.md](cron-jobs.md) — daily suppression-list maintenance.
- [RFC 7208 — SPF](https://datatracker.ietf.org/doc/html/rfc7208) —
  Sender Policy Framework.
- [RFC 6376 — DKIM](https://datatracker.ietf.org/doc/html/rfc6376) —
  DomainKeys Identified Mail.
- [RFC 7489 — DMARC](https://datatracker.ietf.org/doc/html/rfc7489) —
  Domain-based Message Authentication, Reporting, and Conformance.
- [RFC 8058 — One-click unsubscribe](https://datatracker.ietf.org/doc/html/rfc8058) — `List-Unsubscribe-Post` header.
- [RFC 8314 — TLS for SMTP submission](https://datatracker.ietf.org/doc/html/rfc8314) — TLS requirement.
- [MAAWG sender best common practices](https://www.m3aawg.org/sites/default/files/document/M3AAWG_Senders_BCP_Ver3-2015-02.pdf) — operational guidance.
- [Postmark bounce-type reference](https://postmarkapp.com/developer/api/bounce-api) — TypeCode → meaning.
- [Gmail sender guidelines](https://support.google.com/mail/answer/81126) — Gmail-specific reputation rules.
