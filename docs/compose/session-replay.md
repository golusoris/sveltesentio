# Session replay — consent-gated OpenReplay default, PII-scrubbing, sampling

> User-session recording for debugging, UX research, and support —
> with **consent before initialization** per
> [ADR-0019](../adr/0019-openapi-fetch-rfc9457.md) privacy posture and
> the GDPR/CCPA baseline enforced in
> [consent-management.md](consent-management.md). Default stack is
> OpenReplay (OSS self-host) with PII scrubbing at the capture
> boundary; FullStory and LogRocket are escapes when the ops cost of
> self-hosting outweighs sovereignty concerns.

Session replay is **consent-gated observability**, not telemetry. It
must not initialize before a user has accepted Category C2
("behavioral analytics") in the consent banner; it must stop and
purge on withdrawal. Like analytics, the tooling itself is simple —
the hard part is the scrub rules and the consent integration. Treat
every input as PII by default and allow-list what is safe to capture.

## Related

- [consent-management.md](consent-management.md) — banner + categories
  contract; session-replay gates on category C2
- [analytics.md](analytics.md) — event analytics counterpart
- [sentry-or-equivalent.md](sentry-or-equivalent.md) — error tracking
  with stack-trace scrubbing
- [observability.md](observability.md) — OTel server-side cross-link
- [audit-log.md](audit-log.md) — consent-change audit
- [ADR-0019](../adr/0019-openapi-fetch-rfc9457.md) — privacy posture
- [ADR-0023](../adr/0023-uuidv7-default.md) — `session.id` as UUIDv7

## When to use what — decision tree

```text
Debug repro from user report with explicit consent    → session-replay (THIS)
Aggregate UX funnel analysis (anonymous)              → analytics.md
JS error with stack + breadcrumbs                     → sentry-or-equivalent.md
Server-side trace of a request                        → observability.md
A11y user-study recording with release form           → out-of-band, not this
Marketing heatmap with impression-only                → consent-gated analytics, not replay
```

## Build-vs-buy matrix

| Option | Fit | Cost shape | Notes |
|---|---|---|---|
| **OpenReplay** | DEFAULT self-host, EU data-residency | Infra-only | OSS AGPL, full control, ships its own tracker |
| FullStory | Enterprise-ready, fast onboarding | Per-session cloud | Heavy bundle, strong QoL features |
| LogRocket | Developer-first cloud | Per-session cloud | Good Redux/state integration story |
| Hotjar (recordings) | Marketing UX + heatmaps only | Per-session cloud | Not for engineering debugging |
| Roll-your-own rrweb | Full control, engineering cost | Compute + storage | Possible but ops burden rarely worth it |
| Microsoft Clarity | Free, very broad | Free-cloud | Data leaves EU; fails GDPR sovereignty posture |

## Three build rules

1. **Consent before init.** Scripts do not load until the banner
   resolves a C2 accept; rejection purges any buffered state.
2. **Deny-by-default PII scrubbing** — mask all text inputs, all
   network bodies, all cookies/headers; allow-list the exceptions per
   page.
3. **Sampling + retention bounded per plan.** Never record 100 % at
   production scale; 7–14-day retention is plenty for debug.

## Install — OpenReplay tracker

```bash
pnpm add @openreplay/tracker
pnpm add @openreplay/tracker-assist     # optional live support overlay
pnpm add @openreplay/tracker-fetch      # network capture (scrubbed)
```

## Shape — bounded consent + config

```ts
// src/lib/session-replay/config.ts
import { z } from 'zod';

export const ReplayConfig = z.object({
  projectKey: z.string().min(16),
  ingestPoint: z.string().url(), // e.g. https://replay.example.com/ingest
  sampleRate: z.number().min(0).max(1),
  retentionDays: z.number().int().min(1).max(30),
  captureNetwork: z.boolean(),
  maskAllInputs: z.literal(true), // enforced true — never configurable loose
  capturedConsentCategory: z.literal('C2'),
});
export type ReplayConfig = z.infer<typeof ReplayConfig>;

export const ScrubRule = z.object({
  selector: z.string(),           // CSS selector
  action: z.enum(['mask', 'ignore', 'hide']),
  reason: z.string().min(4),      // required doc comment in-schema
});
export type ScrubRule = z.infer<typeof ScrubRule>;
```

Five config rules:

1. **`maskAllInputs: true` is a literal** — the schema refuses `false`
   so a code review cannot accidentally un-mask globally.
2. **`sampleRate` capped** per plan tier; dashboards show
   "% of eligible sessions recorded" not raw percent.
3. **Retention ≤ 30 days** — longer is rarely useful and extends
   breach-notification blast radius.
4. **`ingestPoint` always first-party origin** (your `replay.` subdomain
   proxying OpenReplay) — avoids third-party cookie loss + blocks.
5. **`capturedConsentCategory` is part of the contract** — future
   audits can prove which category gated capture.

## Lifecycle — init gated on consent

```ts
// src/lib/session-replay/init.ts
import Tracker from '@openreplay/tracker';
import trackerFetch from '@openreplay/tracker-fetch';
import { ReplayConfig } from './config';
import { onConsentChange, hasConsent } from '$lib/consent';

let tracker: Tracker | null = null;

export async function initReplay(cfg: ReplayConfig): Promise<void> {
  if (!hasConsent('C2')) return; // no-op until accepted

  tracker = new Tracker({
    projectKey: cfg.projectKey,
    ingestPoint: cfg.ingestPoint,
    captureIFrames: false,
    obscureTextEmails: true,
    obscureTextNumbers: true,
    obscureInputEmails: true,
    obscureInputNumbers: true,
    obscureInputDates: true,
    defaultInputMode: 2, // obscure all by default; allow-list via data-openreplay-*
    capturePerformance: true,
    captureExceptions: true,
    network: cfg.captureNetwork
      ? { sessionTokenHeader: false, capturePayload: false }
      : undefined,
  });
  tracker.use(trackerFetch({ sessionTokenHeader: false }));

  const sampled = Math.random() < cfg.sampleRate;
  if (!sampled) return;

  await tracker.start();
}

onConsentChange((categories) => {
  if (!categories.includes('C2')) {
    void tracker?.stop();
    void tracker?.coldStart(undefined, { forceNew: false }); // flushes + resets
    tracker = null;
  }
});
```

Seven lifecycle rules:

1. **No-op when consent is absent.** `initReplay` returns early; the
   tracker module must not emit a single network byte.
2. **`defaultInputMode: 2` = obscure-all**; allow-listing via
   `data-openreplay-obscured="false"` is explicit and reviewable.
3. **`obscureText*` + `obscureInput*` enabled for emails/numbers/
   dates** — defense in depth alongside input masking.
4. **`captureIFrames: false`** — third-party iframes (Stripe, reCAPTCHA)
   are out of your PII discipline.
5. **`capturePayload: false` on network** — URLs + status codes are
   enough; bodies are routinely PII-heavy.
6. **`sessionTokenHeader: false`** — prevents propagation of auth
   tokens into replay metadata.
7. **Consent withdrawal stops + purges** the current session and
   prevents `coldStart` from leaking buffered state.

## Scrub rules — deny by default, allow by annotation

```svelte
<!-- Safe to capture -->
<h1 data-openreplay-obscured="false">Dashboard</h1>

<!-- Explicitly hidden from replay -->
<section data-openreplay-hidden>
  <p>API key: {apiKey}</p>
</section>

<!-- Masked content (shape-preserving) -->
<input type="text" name="ssn" data-openreplay-masked />
```

Six scrub rules:

1. **Everything is obscured** by default via `defaultInputMode: 2`.
2. **`data-openreplay-hidden`** drops the element entirely from the
   DOM snapshot — use for payment fields, secrets, and any
   unambiguously sensitive region.
3. **`data-openreplay-masked`** preserves shape (width, character
   count) for UX analysis without revealing characters.
4. **`data-openreplay-obscured="false"`** is the *only* way text
   becomes readable — code review must ask "why" on every addition.
5. **Iframe content never recorded** even if `captureIFrames` flipped
   — assumes third-party content.
6. **CSP `connect-src` allow-lists only your proxied ingest origin** —
   a leak to `app.openreplay.com` would surface in CSP reports.

## PII scrub at capture and at network

```ts
// src/lib/session-replay/scrub.ts
const HEADER_DENYLIST = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-session-id',
];

const URL_PARAM_DENYLIST = ['token', 'access_token', 'id_token', 'email'];

export function scrubRequest(req: {
  url: string;
  headers: Record<string, string>;
}): { url: string; headers: Record<string, string> } {
  const url = new URL(req.url);
  for (const p of URL_PARAM_DENYLIST) if (url.searchParams.has(p)) url.searchParams.set(p, '[REDACTED]');
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    headers[k] = HEADER_DENYLIST.includes(k.toLowerCase()) ? '[REDACTED]' : v;
  }
  return { url: url.toString(), headers };
}
```

Five scrub-network rules:

1. **Header denylist** never captures `authorization`, cookies, or
   custom auth headers — even when `capturePayload: false`, headers
   can leak tokens.
2. **URL query-param denylist** for tokens in querystrings (OAuth
   implicit flow redirects, magic-link URLs).
3. **POST body capture is OFF by default** — opt-in only for
   endpoints proven to be non-PII.
4. **`[REDACTED]` is the only replacement** — shape-preserving lies
   ("`x***@example.com`") have leaked real data historically.
5. **Test the scrub fn with property tests** — known-leaky inputs must
   redact; known-safe inputs must pass through.

## Consent integration

```ts
// wire into src/hooks.client.ts
import { ConsentBanner, initConsent } from '$lib/consent';
import { initReplay, readReplayConfig } from '$lib/session-replay';

initConsent();
const cfg = readReplayConfig();
void initReplay(cfg);
```

Six consent rules:

1. **Consent state is server-known**, not just a cookie — a tampered
   cookie must not enable capture.
2. **Withdrawal is retroactive** — stop + purge + notify ingest to
   delete the current session.
3. **Consent version bumps purge** — a new C2 scope (e.g. "including
   support assist") re-prompts.
4. **Children's accounts (under-16 where applicable) never record** —
   schema-level gate before even showing the banner category.
5. **Tenants can force-off** session replay via a tenant setting;
   user-level opt-in can't enable it if the tenant opts out.
6. **Audit `consent_changed`** on accept/withdraw with category list
   (no PII) — see [audit-log.md](audit-log.md).

## Sampling + cost control

Five sampling rules:

1. **Global rate** tuned per plan — 10 % free tier, 50 % pro, 100 %
   for paying enterprise.
2. **Upgrade sampling for error paths** — if a session throws an
   unhandled exception within the first 30 s, always retain it.
3. **Tenant-scoped overrides** — a debugging window can raise to
   100 % for one tenant for 24 h via a dashboard control with audit.
4. **Per-route sampling** — always record `/checkout` near-full, cap
   `/marketing` low.
5. **Storage cost alerts** — dashboard of GB/tenant with a hard
   threshold that pauses capture before it breaches budget.

## Linking to other signals

```ts
// on user sign-in
tracker?.setUserID(user.id);       // pseudonymous ID — never PII
tracker?.setMetadata('tenant', user.tenantId);
tracker?.setMetadata('plan', user.plan); // bounded enum

// on error
tracker?.handleError(err); // also captured by sentry; replay URL in issue
```

Five linkage rules:

1. **`setUserID` is opaque** — pseudonymous, not email or username.
2. **Metadata values are bounded enums** (plan, tenant, role) — never
   free-form to avoid cardinality explosion and accidental PII.
3. **Sentry integration** puts replay URL in every error — but never
   the reverse (replay must not pull from Sentry).
4. **OTel `trace_id` propagation** via custom header lets server
   traces link back to replays for privileged debugging only.
5. **Customer-support tool** surfaces replay URL only to role
   `support-agent+` with an audit entry per view.

## A11y considerations

Four a11y rules:

1. **Do not record assistive-tech output** — Open\Replay DOM capture
   omits `aria-live` speech; ensure the tracker does not stringify
   live regions.
2. **Captions and signed-video content** are user-sensitive — include
   them in the same scrub tier as video frames.
3. **High-contrast/preferred-reduced-motion** preferences are recorded
   as metadata (bounded enum), not as full CSS snapshots.
4. **Accessible consent re-prompt** — the banner is keyboard-navigable
   (see [consent-management.md](consent-management.md)) and the
   withdrawal action is a labeled button in account settings.

## Observability

Bounded attributes:

- `replay.provider` — `openreplay|fullstory|logrocket|disabled`
- `replay.sampled` — `true|false`
- `replay.consent_category` — `C2`
- `replay.scrub.rule_id` — bounded list of annotation IDs triggered
- `replay.session_bucket` — bucketed duration `<30s|30-300s|300s+`

Gauges:

- `replay.capture_bytes_per_session_p95`
- `replay.consent_withdraw_rate`
- `replay.scrub_failures` (should be 0; any spike is a scrub-fn bug)

Alerts:

- Any ingest traffic with `replay.consent_category != 'C2'` —
  immediate page, stop-the-line.
- Scrub fn failures > 0 — block ingest until fixed.
- Retention exceeds `retentionDays` — compliance paging.

## Testing

Five lanes:

1. **Unit** — scrub fn: known-leaky inputs redact; known-safe pass.
2. **Consent gating** — `initReplay` is a no-op when C2 absent;
   withdrawal stops + purges.
3. **Playwright** — visit + deny consent → no ingest request fires.
4. **Playwright** — accept + interact → ingest fires with scrubbed
   headers (intercept + assert).
5. **Chaos** — network to ingest down → tracker must not queue
   unbounded in-memory; drop with backpressure.

## Anti-patterns

1. **Initializing the tracker on page load** before consent is
   resolved — single biggest GDPR risk.
2. **`defaultInputMode: 0`** (capture everything) "just for debug" —
   finds its way to prod.
3. **Capturing full response bodies** — universally leaks PII.
4. **Using vendor cloud in EU without DPA** — compliance failure.
5. **Sending `authorization` headers unscrubbed** — auth token in
   replay = session hijack tool for any replay admin.
6. **Email masking like `x***@example.com`** — leaks domain and
   partial content; use `[REDACTED]`.
7. **Replay retention > 30 days** — regulatory + breach exposure.
8. **Role-free access** to replays — anyone who can log into the
   dashboard can watch any session.
9. **No audit of replay views** — you need to be able to answer "who
   watched session X?" in a breach.
10. **Per-user unique metadata** — cardinality bomb on vendor side.
11. **Capture behind feature flag without consent** — flag cannot
    override regulatory gate.
12. **Relying on "we'll scrub on ingest"** — scrub at capture; ingest
    scrub is last-line defense, not primary control.
13. **Iframe content captured** — third-party PII out of your control.
14. **Upgrading sampling without notifying users** — material change
    to processing scope; re-prompt consent.
15. **Recording admin / support sessions without disclosure** —
    impersonation + replay becomes double surveillance; separate
    consent posture is required.
16. **No kill switch** — a runtime config that pauses ingest in
    seconds must exist.
17. **URL params with tokens** captured unscrubbed — magic-link
    flows, OAuth callbacks.
18. **Storing replays in same bucket as backups** — lateral blast
    radius; isolate.

## References

- [ADR-0019 — openapi-fetch + RFC 9457](../adr/0019-openapi-fetch-rfc9457.md)
- [ADR-0023 — UUIDv7 default](../adr/0023-uuidv7-default.md)
- [OpenReplay docs](https://docs.openreplay.com/)
- [OpenReplay privacy controls](https://docs.openreplay.com/en/installation/privacy/)
- [GDPR Art. 4(1), 6, 7 — consent + processing basis](https://gdpr-info.eu/art-4-gdpr/)
- [CCPA / CPRA §1798.100 et seq.](https://oag.ca.gov/privacy/ccpa)
- [consent-management.md](consent-management.md) / [analytics.md](analytics.md) / [sentry-or-equivalent.md](sentry-or-equivalent.md) / [audit-log.md](audit-log.md) / [observability.md](observability.md)
