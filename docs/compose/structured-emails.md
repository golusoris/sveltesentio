# Structured emails — mjml-svelte for transactional rendering

Transactional email is the **worst-rendered surface in the product**:
Outlook 2016 uses Microsoft Word's HTML engine, Gmail strips `<style>`
tags from non-whitelisted mail hosts, iOS Mail respects `prefers-color-scheme`
but Gmail's dark mode invents its own inverted palette, and every
client has a different `max-width` it treats as hostile. MJML (Mailjet
Markup Language) compiles to table-layout HTML that survives this
mess; `mjml-svelte` lets us author MJML **with Svelte 5 components and
runes** so transactional templates share tokens with the rest of the
UI rather than living in a separate HTML fork.

Per [principles.md §2.2](../principles.md) (OWASP — no user-content
HTML without sanitization) and [ADR-0019](../adr/0019-structured-error-envelope.md)
(structured contracts at every boundary), this recipe covers: MJML-vs-custom
decision, `mjml-svelte` authoring pattern, Zod-validated template props,
a11y contract (plain-text alternative mandatory, alt text on every
image, SR-order matches visual order), and send-provider matrix
(Postmark / Resend / SES / SMTP).

## Related

- [schemas.md](schemas.md) — every template has a Zod props schema.
- [i18n-runtime-strategy.md](i18n-runtime-strategy.md) — Paraglide
  messages apply to email bodies too; use the `server/emails` tree
  namespace.
- [theming.md](theming.md) — email tokens are a **subset** of the web
  palette (no oklch in Outlook — fallback to hex). See tokens section.
- [observability.md](observability.md) — send attempts emit OTel span
  `email.send` with `email.template`/`email.provider`/`email.outcome`
  enum attributes. Never attach `email.to` as a label (PII + cardinality).
- [webhooks.md](webhooks.md) — bounce / complaint webhooks from
  provider land via HMAC-signed receiver; update suppression list.
- [audit-log.md](audit-log.md) — password-reset / email-change sends
  are compliance events, emit to audit sink parallel to provider send.
- [feature-flags.md](feature-flags.md) — gradual rollout of a new
  template through a flag with exposure events; kill-switch for
  regressions.
- [ai-audit-hook.md](ai-audit-hook.md) — AI-generated email copy
  requires audit trail; never send raw LLM output without human review
  gate.
- [principles.md §2.3](../principles.md) — WCAG 2.2 AA also applies to
  email surfaces.

## When to use MJML (default) vs raw HTML (escape)

```text
Any transactional email with layout (header/body/footer/buttons)   → MJML
Plain-text-only receipt or notification                             → plain-text, no MJML
One-off "sign up for beta" blast with bespoke art direction        → marketing vendor (Customer.io, Beehiiv) NOT product-side
Calendar invite (.ics attachment) with text body                    → plain-text + ics; no MJML
Out-of-band security alert ("new sign-in from X")                  → MJML — a11y + dark-mode matters here
Legacy app with `ejs` templates; migration planned                 → MJML in new folder; migrate per-template
```

MJML handles the 95% product-email cases; marketing-design email
belongs in a vendor-managed ESP flow, not in the repo.

## Build vs buy — send provider

| Option | TLS / DKIM / DMARC | Bounce webhook | Template engine | Suppression API | Best for |
|---|---|---|---|---|---|
| **Postmark** | ✅ enforced | ✅ signed | Native (Mustache) or raw HTML | ✅ | Default transactional; reputation-isolated streams |
| **Resend** | ✅ enforced | ✅ signed | React Email native; raw HTML | ✅ | React-shops already on Resend; OK for us via raw HTML |
| **AWS SES** | Configurable | SNS-routed | None | Manual | High-volume / existing AWS spend |
| **Mailgun** | ✅ | ✅ | Handlebars | ✅ | EU-data-residency requirement |
| **Raw SMTP (e.g. Fastmail, Gmail relay)** | Manual | None | None | Manual | <100/day; dev/preview envs only |

**Default pick: Postmark** for production. Single `servers/` split
per environment + reputation-isolated "Broadcast" vs "Transactional"
streams; bounce + complaint webhooks HMAC-signed and consumable via
[webhooks.md](webhooks.md) pattern. SES belongs in infra-heavy apps;
Resend is fine but has no advantage over Postmark for our use-case.

## Install

```bash
# Authoring
pnpm add -D mjml mjml-svelte
pnpm add -D @faire/mjml-react-wrapper  # optional: render-to-string testing

# Send provider (pick one)
pnpm add postmark    # default
# OR
pnpm add resend
# OR
pnpm add @aws-sdk/client-sesv2

# Validation + observability
pnpm add zod
# OTel already wired per observability.md
```

Environment:

```bash
POSTMARK_SERVER_TOKEN=…
EMAIL_FROM="Acme <no-reply@acme.example>"
EMAIL_REPLY_TO="support@acme.example"
```

## Shape

```text
packages/emails/
  src/
    templates/
      welcome/
        template.mjml.svelte       # visual template
        plaintext.ts               # MANDATORY plain-text alternative
        schema.ts                  # Zod props contract
        preview.ts                 # dev-only preview data
      password-reset/
        template.mjml.svelte
        plaintext.ts
        schema.ts
        preview.ts
    send.ts                        # provider-agnostic send()
    providers/
      postmark.ts
    tokens/
      colors.ts                    # email-safe hex palette
      typography.ts
  test/
    render.test.ts                 # MJML → HTML snapshot
    a11y.test.ts                   # image-alt, heading-order, plain-text presence
```

## Authoring a template

A template is a Svelte 5 component with `$props()` typed by a Zod
schema. The component renders MJML tags (not HTML), which the
MJML compiler translates to table-layout HTML at send time.

```svelte
<!-- packages/emails/src/templates/welcome/template.mjml.svelte -->
<script lang="ts">
  import type { WelcomeProps } from './schema';
  let { userName, ctaUrl, supportEmail }: WelcomeProps = $props();
</script>

<mjml>
  <mj-head>
    <mj-title>Welcome to Acme</mj-title>
    <mj-preview>Let's get you started with your first project.</mj-preview>
    <mj-attributes>
      <mj-all font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" />
      <mj-text color="#0b0c10" font-size="16px" line-height="1.5" />
      <mj-button background-color="#0066ff" color="#ffffff" border-radius="6px" />
    </mj-attributes>
    <mj-style>
      @media (prefers-color-scheme: dark) {
        body, .mj-body { background-color: #0b0c10 !important; }
        .text { color: #f5f5f5 !important; }
      }
    </mj-style>
  </mj-head>
  <mj-body background-color="#f5f5f5">
    <mj-section padding="24px">
      <mj-column>
        <mj-image
          src="https://acme.example/logo.png"
          alt="Acme"
          width="120px"
          padding="0"
        />
      </mj-column>
    </mj-section>
    <mj-section background-color="#ffffff" padding="32px" border-radius="8px">
      <mj-column>
        <mj-text css-class="text" font-size="22px" font-weight="600">
          Welcome, {userName}.
        </mj-text>
        <mj-text css-class="text">
          Your account is ready. Create your first project to get started.
        </mj-text>
        <mj-button href={ctaUrl}>Create a project</mj-button>
        <mj-text css-class="text" font-size="14px" color="#666">
          Questions? Reply to this email or write to {supportEmail}.
        </mj-text>
      </mj-column>
    </mj-section>
    <mj-section padding="24px">
      <mj-column>
        <mj-text align="center" font-size="12px" color="#888">
          You received this email because you signed up at acme.example.
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>
```

**Seven authoring rules:**

1. Every template has a **`<mj-title>` + `<mj-preview>`**. Title
   appears in screen readers; preview is inbox-list preview text.
2. Every **image has an `alt`** attribute. Decorative images get
   `alt=""` (empty, not missing).
3. Font-family is system-stack, not a custom font. Outlook strips
   `@font-face`; custom fonts silently downgrade to Times New Roman.
4. Dark-mode via `prefers-color-scheme` **only** — never rely on
   Gmail dark mode inverting your palette. Test both modes.
5. No oklch, no CSS custom properties, no Grid, no Flexbox. MJML's
   table-layout output is the only reliably-rendered shape.
6. No `<video>`, no `<iframe>`, no JS. Ignored or blocked by every
   real client.
7. Links **always absolute** with https. Relative `href="/foo"` breaks
   in every client.

## Zod props schema + plain-text alternative

Every template exports a schema and a plain-text function:

```ts
// packages/emails/src/templates/welcome/schema.ts
import { z } from 'zod';

export const WelcomeProps = z.object({
  userName: z.string().min(1).max(120),
  ctaUrl: z.string().url().startsWith('https://'),
  supportEmail: z.string().email(),
});

export type WelcomeProps = z.infer<typeof WelcomeProps>;
```

```ts
// packages/emails/src/templates/welcome/plaintext.ts
import type { WelcomeProps } from './schema';

export function welcomePlainText(props: WelcomeProps): string {
  return [
    `Welcome, ${props.userName}.`,
    '',
    'Your account is ready. Create your first project to get started:',
    props.ctaUrl,
    '',
    `Questions? Reply to this email or write to ${props.supportEmail}.`,
    '',
    '--',
    'You received this email because you signed up at acme.example.',
  ].join('\n');
}
```

**Why plain-text is mandatory:** corporate spam filters penalize
HTML-only emails; accessibility clients (VoiceOver on iOS, Braille
displays) prefer `text/plain`; and when HTML rendering breaks
(Outlook quirk, deliverability issue, email reader downgrade),
plain-text is the fallback the user actually reads.

Send provider contract: every `send()` call includes **both** parts
as a multipart/alternative MIME body.

## send.ts — provider-agnostic contract

```ts
// packages/emails/src/send.ts
import mjml2html from 'mjml';
import { render } from 'svelte/server';
import { z } from 'zod';
import { trace, SpanStatusCode } from '@opentelemetry/api';

type SendArgs<P> = {
  template: {
    Component: unknown;               // Svelte component (MJML)
    schema: z.ZodSchema<P>;
    plaintext: (props: P) => string;
  };
  props: P;
  to: string;
  from?: string;
  replyTo?: string;
  headers?: Record<string, string>;    // e.g. X-Idempotency-Key for retries
  tag?: string;                        // Postmark stream tag
  correlationId: string;               // UUIDv7 from request
};

export async function sendEmail<P>({
  template,
  props,
  to,
  from = env.EMAIL_FROM,
  replyTo = env.EMAIL_REPLY_TO,
  headers = {},
  tag,
  correlationId,
}: SendArgs<P>): Promise<{ messageId: string }> {
  const tracer = trace.getTracer('emails');
  return tracer.startActiveSpan('email.send', async (span) => {
    try {
      // 1. Validate props against schema — fail-fast before render.
      const validated = template.schema.parse(props);

      // 2. Render MJML-Svelte → MJML string → HTML via mjml compiler.
      const { body } = render(template.Component, { props: validated });
      const { html, errors } = mjml2html(body, {
        validationLevel: 'strict',   // fail on unknown MJML attrs
        keepComments: false,
      });
      if (errors.length > 0) {
        throw new Error(`mjml_compile_errors: ${errors.map((e) => e.message).join('; ')}`);
      }

      // 3. Plain-text alternative (MANDATORY — never send HTML-only).
      const text = template.plaintext(validated);

      // 4. Provider dispatch.
      const result = await postmark.sendEmail({
        From: from,
        To: to,
        ReplyTo: replyTo,
        Subject: deriveSubjectFromMjmlTitle(html),
        HtmlBody: html,
        TextBody: text,
        MessageStream: tag ?? 'transactional',
        Headers: [
          { Name: 'X-Correlation-Id', Value: correlationId },
          ...Object.entries(headers).map(([Name, Value]) => ({ Name, Value })),
        ],
      });

      span.setAttributes({
        'email.template': tag ?? 'transactional',
        'email.provider': 'postmark',
        'email.outcome': 'accepted',
        'correlation.id': correlationId,
      });
      return { messageId: result.MessageID };
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.setAttributes({ 'email.outcome': 'failed' });
      span.recordException(err as Error);
      throw err;
    } finally {
      span.end();
    }
  });
}
```

**Six invariants:**

1. **Validate first, render second, send third.** A bad props shape
   never reaches the MJML compiler.
2. **MJML strict validation.** Never ship a template with unknown
   MJML attributes — they silently no-op in some clients, crash in
   others.
3. **Plain-text always.** No code path skips `template.plaintext()`.
4. **`X-Correlation-Id` header** threads to provider logs + bounce
   webhooks for end-to-end debugging via [observability.md](observability.md).
5. **OTel span, not log.** Email sends are operations — trace them.
   `email.outcome` is a bounded enum (`accepted`/`failed`/`suppressed`),
   never a free-form string.
6. **Never label with recipient email.** PII + unbounded cardinality;
   use `correlation.id` for per-send join instead.

## Suppression + bounces

Every email-send has a corresponding bounce/complaint path. Bounces
update a suppression list; future sends to suppressed addresses
fail-closed before provider dispatch.

```ts
// packages/emails/src/suppression.ts
export async function isSuppressed(email: string): Promise<boolean> {
  const row = await db.selectFrom('email_suppressions')
    .where('email', '=', email.toLowerCase())
    .where('expires_at', '>', new Date())
    .selectAll()
    .executeTakeFirst();
  return row !== undefined;
}

// In send.ts before dispatch:
if (await isSuppressed(to)) {
  span.setAttributes({ 'email.outcome': 'suppressed' });
  return { messageId: 'suppressed' };
}
```

Bounce webhook endpoint (HMAC-signed per [webhooks.md](webhooks.md)):

```ts
// src/routes/api/webhooks/postmark/+server.ts
// After HMAC verify + event parse:
if (event.Type === 'HardBounce' || event.Type === 'SpamComplaint') {
  await db.insertInto('email_suppressions').values({
    email: event.Recipient.toLowerCase(),
    reason: event.Type,
    suppressed_at: new Date(),
    expires_at: event.Type === 'SpamComplaint'
      ? new Date('9999-12-31')   // permanent
      : addDays(new Date(), 90), // hard-bounce → 90-day cool-off
  }).onConflict((oc) => oc.column('email').doUpdateSet({
    reason: event.Type,
    suppressed_at: new Date(),
  })).execute();
}
```

## A11y contract for email

WCAG 2.2 AA applies to email surfaces. Tests in `a11y.test.ts`:

1. **Heading order** — one `<mj-text font-size="22px" font-weight="600">`
   (visually-h1) per email; no skips.
2. **Image alt** — every `<mj-image>` has non-missing `alt`;
   decorative images use `alt=""`.
3. **Button label** — never "Click here" or "Read more". Use
   "Create a project", "Confirm your email", etc.
4. **Link text** — descriptive, not raw URL. Screen readers announce
   the text, not the href.
5. **Color contrast** — 4.5:1 for body text, 3:1 for headings.
   Default tokens verified in both light and dark scheme.
6. **SR order matches visual order** — no absolute positioning
   tricks (MJML's table output enforces this; don't fight it).
7. **Plain-text presence** — tested by asserting `text.length > 50`
   and `text` contains the CTA URL.

## Render + snapshot testing

```ts
// packages/emails/test/render.test.ts
import { describe, expect, test } from 'vitest';
import mjml2html from 'mjml';
import { render } from 'svelte/server';
import Welcome from '../src/templates/welcome/template.mjml.svelte';
import { welcomePlainText } from '../src/templates/welcome/plaintext';

describe('welcome template', () => {
  const props = {
    userName: 'Alice',
    ctaUrl: 'https://acme.example/onboarding',
    supportEmail: 'support@acme.example',
  };

  test('compiles with zero MJML errors', () => {
    const { body } = render(Welcome, { props });
    const { html, errors } = mjml2html(body, { validationLevel: 'strict' });
    expect(errors).toEqual([]);
    expect(html).toContain('Welcome, Alice');
    expect(html).toContain('href="https://acme.example/onboarding"');
  });

  test('plain-text alternative is present and includes CTA url', () => {
    const text = welcomePlainText(props);
    expect(text.length).toBeGreaterThan(50);
    expect(text).toContain('https://acme.example/onboarding');
  });
});
```

For real-client rendering verification: **Litmus** or **Email on Acid**
against the compiled HTML pre-ship for new templates; CI snapshot
test catches regression on re-renders.

## Preview routes (dev-only)

```ts
// src/routes/(dev)/__email-preview/[template]/+server.ts
import { dev } from '$app/environment';
import { error, json } from '@sveltejs/kit';
import mjml2html from 'mjml';
import { render } from 'svelte/server';
import { templates } from '@sveltesentio/emails/registry';

export async function GET({ params, url }) {
  if (!dev) throw error(404);
  const t = templates[params.template];
  if (!t) throw error(404);
  const format = url.searchParams.get('format') ?? 'html';
  const { body } = render(t.Component, { props: t.preview });
  if (format === 'text') return new Response(t.plaintext(t.preview));
  const { html } = mjml2html(body);
  return new Response(html, { headers: { 'content-type': 'text/html' } });
}
```

Gate behind `dev` — never expose in production.

## Tokens — email-safe palette

Email palette is a **subset** of the web palette:

| Token | Web (oklch) | Email (hex) | Rationale |
|---|---|---|---|
| `--color-bg` | `oklch(0.98 0 0)` | `#f5f5f5` | Outlook has no oklch |
| `--color-surface` | `oklch(1 0 0)` | `#ffffff` | — |
| `--color-text` | `oklch(0.15 0 0)` | `#0b0c10` | 4.5:1 contrast on surface |
| `--color-text-muted` | `oklch(0.45 0 0)` | `#666666` | 4.5:1 for ≥16px only |
| `--color-accent` | `oklch(0.65 0.2 265)` | `#0066ff` | Brand blue; 4.5:1 on white |
| `--color-border` | `oklch(0.92 0 0)` | `#e5e5e5` | Decorative only |

Tokens live in `packages/emails/src/tokens/colors.ts` and are imported
by `<mj-attributes>` — never hard-code hex in templates directly.

## Anti-patterns

- **Don't use CSS Grid, Flexbox, or `position: absolute` in MJML.**
  Table-layout HTML is the only shape that survives Outlook. MJML
  compiles to this automatically; don't fight it with custom CSS.
- **Don't rely on custom fonts.** `@font-face` silently downgrades in
  Outlook and many corporate clients. System-stack only.
- **Don't send HTML without a plain-text alternative.** Spam filters
  penalize it, screen readers prefer it, and when HTML breaks it's
  the fallback. `sendEmail()` must refuse HTML-only input.
- **Don't render templates with raw un-validated props.** A shape
  mismatch lands as a send-time MJML error or worse, a sent email
  with `{undefined}` as the user's name. Zod-validate first.
- **Don't attach `email.to` as an OTel label.** PII + unbounded
  cardinality. Use `correlation.id` for per-send join.
- **Don't put secrets or tokens in email bodies.** Password-reset
  tokens go in a link query param with 15-min expiry, not as
  "your password is X" in the body.
- **Don't use `<mj-raw>` to inject arbitrary HTML.** Bypasses MJML's
  validation; almost always indicates the template is wrong shape
  for the message. Rebuild with MJML components.
- **Don't mix authentication and transactional streams.** Postmark
  reputation is per-stream; a marketing blast landing a spam-report
  doesn't degrade `password-reset` deliverability if they're separate
  streams. Dedicate `transactional`/`marketing`/`auth` streams.
- **Don't skip DKIM + DMARC + SPF.** Without all three, Gmail bulk
  senders (since 2024) reject your email. Provider onboarding is
  the 10-minute window for this, not "later".
- **Don't use AI to write transactional copy without human review.**
  Transactional emails are legal-implication surfaces (consent,
  billing, security alerts). Route AI drafts through a review gate
  and log via [ai-audit-hook.md](ai-audit-hook.md).

## References

- [ADR-0019 — Structured error envelope (boundary contracts)](../adr/0019-structured-error-envelope.md)
- [principles.md §2.2 — OWASP ASVS L2](../principles.md)
- [principles.md §2.3 — WCAG 2.2 AA](../principles.md)
- Sibling recipes: [schemas.md](schemas.md),
  [i18n-runtime-strategy.md](i18n-runtime-strategy.md),
  [observability.md](observability.md),
  [webhooks.md](webhooks.md),
  [audit-log.md](audit-log.md),
  [feature-flags.md](feature-flags.md),
  [ai-audit-hook.md](ai-audit-hook.md),
  [theming.md](theming.md).
- Upstream docs:
  - MJML: <https://mjml.io/documentation/>
  - `mjml-svelte`: <https://github.com/mjmlio/mjml-svelte>
  - Postmark docs: <https://postmarkapp.com/developer>
  - Google bulk-sender requirements (2024): <https://support.google.com/mail/answer/81126>
  - Email Client Support Matrix (Can I Email): <https://www.caniemail.com/>
