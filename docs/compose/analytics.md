# Analytics — Plausible default with PostHog escape + consent-gated pipeline

Web analytics has two honest shapes: **aggregate product analytics**
(how many people viewed the pricing page, which features are used,
what's the funnel drop-off) and **per-user behavioral tracking** (what
did user X click yesterday, what's their session replay, which
variants did they see). The first is low-privacy-cost and legally
cheap; the second is high-privacy-cost and requires opt-in consent,
audit, and a retention policy. Mixing them is how "we added
Plausible" turns into a GDPR complaint three releases later.

This recipe picks **Plausible as default** for privacy-first
aggregate analytics (no cookies, no personal identifiers, EU-hosted,
tiny bundle), codifies **PostHog as opt-in escape** when
product-analytics depth is actually needed, and locks down the
**consent-gated loading contract** via
[consent-management.md](consent-management.md) so analytics never
fires before consent in GDPR regions.

Per [principles.md §2.2](../principles.md) (OWASP ASVS L2 V8 — data
minimization) and [principles.md §2.9](../principles.md) (Core Web
Vitals — analytics must not degrade LCP), the default posture is:
**no cookies, no per-user tracking, no session replay**, until a
specific product question genuinely requires it and the consent flow
supports it.

## Related

- [consent-management.md](consent-management.md) — analytics fires
  only after `consent.c.analytics === true` in GDPR regions; the
  gate is enforced SSR-side.
- [cookies-authoritative.md](cookies-authoritative.md) — PostHog /
  GA4 set tracking cookies that fall under the analytics category;
  Plausible sets none.
- [observability.md](observability.md) — ops-observability (OTel
  metrics, traces, logs) is **not** product analytics. Keep them
  distinct: OTel tells you "the system is healthy", analytics tells
  you "users love feature X".
- [feature-flags.md](feature-flags.md) — exposure events (who saw
  which variant) flow to the analytics pipeline for A/B analysis.
- [audit-log.md](audit-log.md) — compliance events (consent grants,
  admin actions) go to audit, not analytics. Don't conflate.
- [sentry-or-equivalent.md](sentry-or-equivalent.md) — error
  tracking is the "something broke" signal; analytics is the "what
  worked" signal.
- [ai-audit-hook.md](ai-audit-hook.md) — AI usage telemetry
  (prompt/response audit) goes to the AI audit sink, not analytics.
- [ai-audit-hook.md](ai-audit-hook.md) — never let analytics become
  the AI compliance trail.
- [pwa.md](pwa.md) — PWA-install events, standalone-mode detection
  are analytics events; attribution is CSP-friendly.
- [principles.md §2.9](../principles.md) — analytics script must
  not block LCP; defer / async / size-capped.

## Where to measure what

```text
"How many people visited /pricing last week"           → aggregate; Plausible
"Which features do logged-in users use"                → aggregate-per-role; Plausible + custom events
"What's the funnel drop-off in onboarding"             → aggregate-funnel; Plausible goals OR PostHog
"Which specific user clicked the button at 14:23"      → per-user; PostHog — opt-in REQUIRED
"What did user X do before reporting the bug"          → session replay; Sentry / PostHog — opt-in REQUIRED
"A/B test which headline converts better"              → exposure + conversion; feature-flags.md → PostHog
"Is the app slow for users in Brazil"                  → RUM / observability; OTel — NOT analytics
"Who signed up today, where from"                      → audit + attribution; audit-log.md + Plausible referer
"Marketing attribution (which ad drove sign-ups)"      → UTM params + Plausible; opt-in if PII-joined
"How long until users churn"                           → business metric; DB query — NOT a tracking script
```

**Three measurement rules:**

1. **Default to aggregate.** Ninety percent of "we need analytics"
   questions are aggregate-level; reach for per-user tracking only
   when the question actually requires it.
2. **Never mix analytics with OTel ops.** Analytics is "did the
   product work"; OTel is "did the system work". Separate pipelines,
   separate retention, separate dashboards.
3. **Consent-gate everything that's not strictly necessary.** Even
   Plausible (cookieless) falls under analytics-category consent in
   GDPR regions because it still processes personal data (IP,
   User-Agent) at the edge.

## Build vs buy

| Option | Cookies | Per-user | Session replay | GDPR-easy | Self-host | Best for |
|---|---|---|---|---|---|---|
| **Plausible** | ❌ | ❌ aggregate only | ❌ | ✅ EU-hosted | ✅ AGPL | Default pick |
| **Fathom** | ❌ | ❌ | ❌ | ✅ EU option | ❌ SaaS | Plausible SaaS alternative |
| **Umami** | ❌ | ❌ | ❌ | ✅ | ✅ MIT | Plausible OSS alternative; more features |
| **Simple Analytics** | ❌ | ❌ | ❌ | ✅ EU | ❌ SaaS | UX-polished alternative |
| **PostHog** | ⚠️ opt-in | ✅ | ✅ (opt-in) | ⚠️ EU region | ✅ MIT | When per-user depth is needed |
| **Pirsch** | ❌ | ⚠️ partial | ❌ | ✅ EU | ❌ SaaS | German-market Plausible alternative |
| **Matomo** | ⚠️ | ✅ | ⚠️ plugin | ✅ | ✅ GPL | Full-featured OSS (heavier ops) |
| **GA4** | ✅ | ✅ | ❌ | ❌ Schrems II issues | ❌ SaaS | Avoid for new EU-facing products |
| **Mixpanel / Amplitude** | ✅ | ✅ | ❌ | ⚠️ | ❌ | Paid product-analytics; opt-in mandatory |

**Default pick: Plausible** (self-host or EU SaaS) for aggregate
page-views, goals, referrers, and custom events. Cookieless by
design — no consent required in GDPR regions for truly aggregate use
(consent practices still recommended; legal analysis varies by DPA).

**Escape to PostHog** when specific per-user questions arrive —
funnel analysis, cohort retention, session replay for support,
feature-flag exposure analysis. PostHog is MIT-licensed and
self-hostable; the escape is real, not vendor-locked.

**Never pick GA4 for new EU-facing products.** Schrems II + French
CNIL + Italian Garante rulings make GA4 a compliance risk; the
cost-per-incident outweighs any feature parity win.

## Install — Plausible default

```bash
# No client SDK needed — Plausible is a single script tag.
# For custom events:
pnpm add -D plausible-tracker   # optional, typed helper
```

Environment:

```bash
PUBLIC_PLAUSIBLE_DOMAIN=acme.example
PUBLIC_PLAUSIBLE_SCRIPT_URL=https://plausible.internal/js/script.js  # self-host
# OR cloud: https://plausible.io/js/script.js
```

Self-host if:
- EU-only customer base with strict data-residency.
- Cost: SaaS starts at ~$9/mo; self-host ops cost is real (Postgres
  + ClickHouse + ingest pipeline). SaaS wins until scale demands it.

## Shape

```text
src/lib/analytics/
  plausible.ts             # typed event helpers
  posthog.ts               # opt-in escape (lazy-imported)
  consent-gate.ts          # read consent state; decide what to load
  events.ts                # event-name enum (bounded)
  attribution.ts           # UTM capture (SSR-side)
src/routes/
  +layout.svelte           # conditional script loading
  +layout.server.ts        # consent + attribution SSR resolution
```

## Event catalog — bounded enum

```ts
// src/lib/analytics/events.ts
import { z } from 'zod';

export const AnalyticsEvent = z.enum([
  // Marketing / top-funnel
  'pageview',                 // auto-fired by Plausible
  'cta_clicked',
  'pricing_plan_viewed',

  // Activation
  'sign_up_started',
  'sign_up_completed',
  'onboarding_step_completed',
  'first_project_created',

  // Engagement
  'feature_used',
  'doc_searched',

  // Retention / billing
  'subscription_started',
  'subscription_canceled',
  'subscription_upgraded',

  // Errors surfaced to user
  'error_shown',
]);
export type AnalyticsEvent = z.infer<typeof AnalyticsEvent>;
```

**Four event-catalog rules:**

1. **Bounded enum, not free-form strings.** A new event is a code
   change reviewed in a PR. "Track this too" requests without a PR
   don't land.
2. **Past-tense verbs**, noun-qualified (`sign_up_completed`, not
   `userDidSignUp`). Grammatically uniform event names compose into
   readable funnels.
3. **Events track business-meaningful actions**, not UI mechanics.
   `cta_clicked` is useful; `button_focused` is noise.
4. **No PII in event names or properties.** `sign_up_completed` —
   yes; `user_signed_up_as_alice@example.com` — never.

## Event properties — bounded, non-PII

```ts
// src/lib/analytics/plausible.ts
import { browser } from '$app/environment';

type EventProps = {
  plan?: 'free' | 'pro' | 'team' | 'enterprise';     // bounded enum
  source?: 'web' | 'email' | 'in-app';               // bounded enum
  feature?: string;                                   // <64 chars, catalog-enforced
  locale?: string;                                    // 'en' | 'de' | ...
  // NEVER: userId, email, name, raw query strings, IPs
};

export function track(event: string, props: EventProps = {}): void {
  if (!browser) return;
  const plausible = (window as { plausible?: (e: string, opts?: { props?: EventProps }) => void }).plausible;
  if (!plausible) return;                             // not loaded (no consent, blocked)
  plausible(event, { props });
}
```

**Five property rules:**

1. **Properties are bounded enums where possible.** `plan: 'pro'` is
   a facet dimension; `plan: 'user upgraded from free to pro on
   2026-04-18'` is a label explosion.
2. **No PII, ever.** No user IDs, emails, names, raw queries, IPs,
   addresses. The Plausible aggregate guarantee depends on this.
3. **Server-side event emission is possible but NOT default.**
   Server-side analytics adds IPs to the pipeline; in GDPR regions
   that's harder to justify than client-side cookieless.
4. **No free-form `description` field.** Prevents ad-hoc
   property-names from sprawling; each new dimension is an enum
   extension.
5. **`track()` no-ops if Plausible isn't loaded.** Consent not
   granted, adblocker blocked, offline — all normal; no thrown
   errors.

## Consent-gated loading

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import type { LayoutData } from './$types';
  import { PUBLIC_PLAUSIBLE_DOMAIN, PUBLIC_PLAUSIBLE_SCRIPT_URL } from '$env/static/public';
  let { data, children }: { data: LayoutData; children: any } = $props();
</script>

<svelte:head>
  {#if data.consent.c.analytics}
    <script
      defer
      data-domain={PUBLIC_PLAUSIBLE_DOMAIN}
      src={PUBLIC_PLAUSIBLE_SCRIPT_URL}
    ></script>
    <script>
      window.plausible = window.plausible || function() { (window.plausible.q = window.plausible.q || []).push(arguments); };
    </script>
  {/if}
</svelte:head>

{@render children()}
```

**Four loading rules:**

1. **SSR-rendered conditional, not client-side `if`.** The `<script>`
   tag is either in the HTML or it isn't; no post-hydrate injection
   (which is tracker-before-consent in disguise).
2. **`defer` attribute mandatory.** Analytics scripts must never
   block the parser or LCP per
   [principles.md §2.9](../principles.md).
3. **Queue shim (`window.plausible = function…`)** for calls before
   script load. Event emissions from the first paint don't get
   dropped.
4. **Consent-withdrawal unloads on reload.** Mid-session withdrawal
   per [consent-management.md](consent-management.md) triggers a
   reload; the next render omits the script.

## Page-view tracking on client-routing

Plausible's default script binds to browser navigation, but
SvelteKit's client-side routing can lose page-view events. Use the
`script.manual.js` variant + explicit `pageview` tracking:

```svelte
<!-- src/routes/+layout.svelte — if using manual mode -->
<script lang="ts">
  import { afterNavigate } from '$app/navigation';
  import { track } from '$lib/analytics/plausible';

  afterNavigate(({ to }) => {
    if (!to) return;
    track('pageview', { path: to.url.pathname });   // built-in; path is the ONE allowed URL-shaped prop
  });
</script>
```

The `script.pageview-props.js` variant also allows custom props on
pageview events if a trackable dimension (e.g. "authenticated vs
anonymous" page state) matters.

## Goals — funnels via custom events

Plausible's "goals" are just named custom events viewed through a
funnel UI. Define them in the event catalog:

```text
Funnel: Onboarding activation
  sign_up_started
  sign_up_completed
  onboarding_step_completed (step=1)
  onboarding_step_completed (step=4)
  first_project_created
```

Drop-off rate per step is the product signal. Plausible goals panel
shows this without per-user data.

## Attribution — UTM capture SSR-side

```ts
// src/lib/analytics/attribution.ts
const UTM_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;

export function captureAttribution(url: URL, cookies: Cookies): void {
  const incoming: Record<string, string> = {};
  for (const key of UTM_PARAMS) {
    const v = url.searchParams.get(key);
    if (v && v.length < 64) incoming[key] = v;
  }
  if (Object.keys(incoming).length === 0) return;

  // First-touch attribution: only set if not already set (90-day window).
  if (!cookies.get('__Host-attribution')) {
    cookies.set('__Host-attribution', JSON.stringify({ ...incoming, firstTouchAt: Date.now() }), {
      path: '/', secure: true, httpOnly: false, sameSite: 'lax', maxAge: 60 * 60 * 24 * 90,
    });
  }
}
```

**Three attribution rules:**

1. **First-touch not last-touch** by default — the UTM of the first
   visit is preserved until it expires. Most teams eventually want
   both; start with first-touch.
2. **`httpOnly: false`** because the analytics client reads it to
   attach to sign-up conversion events.
3. **Max-Age 90 days.** Longer attribution windows require opt-in
   (advertising category) under strict interpretations.

Sign-up event includes attribution:

```ts
track('sign_up_completed', {
  source: attribution.utm_source as 'organic' | 'web' | 'email',
});
```

## PostHog opt-in — when aggregate isn't enough

PostHog is the escape for per-user analytics. It requires:

1. Explicit user opt-in beyond the analytics category — a separate
   "advanced product analytics" consent entry OR wait until an
   authenticated user explicitly enables it (in `/privacy` settings).
2. Lazy-loaded — 50+ KB bundle cost; only loaded for consented users.
3. Identified via stable hash (not raw user ID) — so PostHog's data
   export doesn't directly PII-deanonymize.

```ts
// src/lib/analytics/posthog.ts
export async function initPosthogIfConsented(consent: ConsentState, user: User | null): Promise<void> {
  if (!consent.c.analytics || !user?.advancedAnalyticsOptIn) return;

  const { posthog } = await import('posthog-js');
  posthog.init(env.PUBLIC_POSTHOG_KEY, {
    api_host: env.PUBLIC_POSTHOG_HOST,
    autocapture: false,                              // never auto-capture clicks (over-collection)
    capture_pageview: false,                         // we emit via afterNavigate
    disable_session_recording: true,                 // opt-in feature; off by default
    persistence: 'memory',                           // no cookies by default
    mask_all_text: true,                             // if replay ever enabled
    bootstrap: {
      distinctID: await hashUserId(user.id, env.POSTHOG_HASH_SALT),   // pseudonymous
    },
  });
}
```

**Six PostHog invariants:**

1. **`autocapture: false`** — auto-clicking every button is
   over-collection. Explicit events only.
2. **`disable_session_recording: true` by default.** Enable only per
   specific replay consent (separate from analytics category).
3. **`persistence: 'memory'`** — no cookies until user opts into
   "remember across sessions", which should be a separate UI
   decision.
4. **`mask_all_text: true`** if replay is ever enabled. Same privacy
   baseline as Sentry replay per
   [sentry-or-equivalent.md](sentry-or-equivalent.md).
5. **`distinctID` is a pseudonymous hash** — `HMAC-SHA256(userId,
   serverSalt)` — so a PostHog export can't trivially join to the
   product DB without the salt.
6. **Lazy-import gates on consent.** No PostHog bundle ship if
   consent is absent.

## Testing

```ts
// packages/analytics/test/track.test.ts
import { describe, expect, test, vi } from 'vitest';
import { track } from '../src/plausible';

describe('plausible track', () => {
  test('noops when plausible is not on window', () => {
    expect(() => track('pageview')).not.toThrow();
  });

  test('emits when plausible exists', () => {
    const spy = vi.fn();
    (window as any).plausible = spy;
    track('cta_clicked', { plan: 'pro' });
    expect(spy).toHaveBeenCalledWith('cta_clicked', { props: { plan: 'pro' } });
  });
});
```

Playwright lane:

1. No-consent visit: assert no Plausible script tag in DOM, no
   network request to `script.js`.
2. Consent-granted visit: assert script tag present, pageview
   request made.
3. Consent-revoked mid-session: reload and assert (1) again.

## Observability vs analytics — don't conflate

A request handler emits:

```ts
// OTel — ops health
span.setAttribute('http.response.status_code', 200);
metrics.requestDuration.record(ms, { route: '/api/orders' });

// Analytics — product signal (only if authenticated user acted)
if (authenticatedUserAction) {
  track('feature_used', { feature: 'order-create' });
}
```

**Five separation rules:**

1. **OTel is per-request, always.** Every HTTP request emits OTel.
   Consent doesn't gate ops observability.
2. **Analytics is per-user-action, consent-gated.** Not every request
   is an analytics event; page views and deliberate user actions are.
3. **Different retention.** OTel: 30-90 days. Analytics aggregate:
   years. Audit: 7 years. Don't conflate retention policies.
4. **Different dashboards.** Grafana shows OTel; Plausible
   dashboard shows product analytics. A unified "everything"
   dashboard is a mistake waiting to leak metrics into product
   decisions.
5. **Different people.** Oncall reads OTel; product reads analytics.
   Mixing them produces meetings nobody attends.

## Anti-patterns

- **Don't load analytics before consent.** Even cookieless Plausible
  processes IP at the edge; GDPR analytics-category consent is the
  prudent default. The "but it's just aggregate" argument loses
  in enforcement.
- **Don't use GA4 for new EU-facing products.** Schrems II + French
  / Italian / Austrian DPA rulings make it a hosting-location issue
  at best, a full-lawsuit magnet at worst.
- **Don't track PII in analytics.** No emails, no names, no IPs, no
  raw search queries, no addresses. The data leaves your system;
  minimize what leaves.
- **Don't use OTel as product analytics.** OTel is sampled, retained
  30-90 days, and high-cardinality labels are expensive. Product
  analytics needs unsampled long-retention aggregated views.
- **Don't use analytics as audit.** Analytics is aggregate and
  sampled and can be blocked by adblockers. A regulator asking "who
  canceled their subscription on 2026-01-15" gets audit data, not
  Plausible stats.
- **Don't enable PostHog autocapture.** "Capture every click"
  sounds powerful; in practice it generates 10-100× the events you
  need and creates a data-minimization violation.
- **Don't enable PostHog session recording by default.** Session
  replay records PII by default (text, forms, URLs). Requires
  explicit consent beyond "analytics" category and aggressive masking
  per [sentry-or-equivalent.md](sentry-or-equivalent.md).
- **Don't attach user identities to analytics events.** Even
  pseudonymous IDs join back to users via timing attacks. Aggregate
  by default; identify only in an opt-in per-user tool.
- **Don't emit events from every component mount.** Noise swamps
  signal; `feature_used` once per user-action, not once per render.
- **Don't build your own analytics pipeline.** The "just log to S3
  and query Athena" impulse lasts until the first retention-policy
  question or DPA complaint. Buy Plausible / Umami / Fathom;
  self-host if budget demands.
- **Don't track experimentation without flags.** A/B tests belong
  in [feature-flags.md](feature-flags.md); emitting `variant_a`/`variant_b`
  events without a flag definition creates dead experiments.
- **Don't forget to remove analytics calls for retired features.**
  Zombie events (`old_feature_used`) dilute analytics hygiene and
  embarrass during compliance audits.
- **Don't ship marketing pixels alongside analytics.** Meta Pixel /
  LinkedIn Insight / TikTok pixel fall under advertising category,
  not analytics. Separate consent, separate load gate.
- **Don't log raw URLs with query strings.** Query strings contain
  PII (share tokens, email links, session refs). Strip or truncate
  before sending to analytics.
- **Don't use analytics to page oncall.** Error-rate alerts live in
  [sentry-or-equivalent.md](sentry-or-equivalent.md) + OTel; analytics
  is not an alerting system.

## References

- [principles.md §2.2 — OWASP ASVS L2 V8 (data minimization)](../principles.md)
- [principles.md §2.9 — Core Web Vitals (analytics not blocking LCP)](../principles.md)
- Sibling recipes: [consent-management.md](consent-management.md),
  [cookies-authoritative.md](cookies-authoritative.md),
  [observability.md](observability.md),
  [feature-flags.md](feature-flags.md),
  [audit-log.md](audit-log.md),
  [sentry-or-equivalent.md](sentry-or-equivalent.md),
  [ai-audit-hook.md](ai-audit-hook.md),
  [pwa.md](pwa.md).
- Upstream docs:
  - Plausible documentation: <https://plausible.io/docs>
  - PostHog SvelteKit guide: <https://posthog.com/docs/libraries/svelte>
  - Umami documentation: <https://umami.is/docs>
- Regulatory references:
  - CNIL GA4 ruling (2022): <https://www.cnil.fr/en/use-google-analytics-and-data-transfers-united-states-cnil-orders-website-manageroperator-comply>
  - Schrems II (CJEU C-311/18): <https://curia.europa.eu/juris/documents.jsf?num=C-311/18>
  - EDPB Guidelines on data analytics: <https://edpb.europa.eu/our-work-tools/general-guidance/guidelines-recommendations-best-practices_en>
