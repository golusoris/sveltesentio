# Consent management — GDPR/CCPA banner + IAB TCF + regional targeting

Privacy regulation imposes a **verifiable consent gate** before any
non-essential cookie, tracker, or third-party script loads. GDPR
(EU/EEA/UK) requires **opt-in** for analytics/advertising; CCPA
(California, expanded by CPRA) requires **opt-out** with a "Do Not
Sell or Share" link; LGPD (Brazil) mirrors GDPR; Quebec's Law 25
mirrors GDPR with additional rules. Getting this wrong is a real
regulatory fine, not a theoretical one.

The compliance surface has two halves: **gating** (don't fire the
third-party script until the user has consented) and **proving**
(keep a record of who consented to what, when). Both halves wire
through a **consent state machine** that SSR + client both read from
before any tag fires. Per [principles.md §2.2](../principles.md)
(OWASP ASVS L2 — privacy-by-default) and
[cookies-authoritative.md](cookies-authoritative.md) (Set-Cookie
matrix), this recipe picks **Klaro** as the default banner SDK,
defines the SSR-first consent-cookie contract, and codifies the
IAB TCF v2.2 integration for AdTech flows.

## Related

- [cookies-authoritative.md](cookies-authoritative.md) — the consent
  cookie itself follows the Secure/JS-readable row in the matrix;
  category-gated cookies follow their own rows.
- [audit-log.md](audit-log.md) — consent granted / consent withdrawn
  are compliance events with 7-year retention.
- [observability.md](observability.md) — consent rates per category
  emit as bounded OTel counters; never attach session IDs.
- [feature-flags.md](feature-flags.md) — regional targeting (show
  GDPR banner only in EU/EEA/UK) via server-side `geo.country` flag
  evaluation; the flag drives UI, not the consent contract.
- [i18n-runtime-strategy.md](i18n-runtime-strategy.md) — banner copy
  localized per region; GDPR demands the banner be in the user's
  language.
- [ai-audit-hook.md](ai-audit-hook.md) — AI-personalization consent
  is a category of its own per EU AI Act.
- [structured-emails.md](structured-emails.md) — withdrawal of
  marketing consent triggers suppression-list update per webhook
  sibling.
- [trusted-types.md](trusted-types.md) — CSP `script-src` gates
  third-party loading; consent gates do not replace CSP.
- [theming-flash-free.md](theming-flash-free.md) — same SSR-cookie
  pattern; consent cookie must resolve before first paint to avoid
  banner-flash.
- [principles.md §2.2](../principles.md) — OWASP ASVS L2 V8
  (protection of sensitive data + consent).

## Legal baseline — what consent actually means

```text
Essential (session cookies, CSRF, __Host-* auth)   → no consent needed anywhere
Functional (theme, locale, remembered language)    → consent needed EU; legitimate-interest debatable
Analytics (GA, Plausible, PostHog sans-personal)   → opt-in EU; opt-out CCPA
Advertising (Meta Pixel, Google Ads, LinkedIn)     → opt-in EU; opt-out CCPA + IAB TCF
Marketing comms (email tracking, product updates)  → opt-in EU; double-opt-in DE; opt-out CCPA
Session replay (FullStory, Hotjar, LogRocket)      → opt-in EU — records PII by default
AI personalization / ML-profiling                  → opt-in EU per EU AI Act; purpose-specific
Cross-context behavioral ad (CCPA)                 → specific "Do Not Sell or Share" opt-out
```

**Four legal rules baked into the shape:**

1. **Essential cookies never need consent.** Session, CSRF, `__Host-*`
   auth cookies load unconditionally.
2. **Opt-in default in EU/EEA/UK.** No checkboxes pre-checked; no
   "continue to use the site = consent"; dismiss ≠ accept.
3. **Opt-out default in California.** "Do Not Sell or Share My
   Personal Information" link must be present on every page, not
   hidden in a privacy policy.
4. **Withdrawal as easy as grant.** If consent takes one click,
   withdrawal takes one click. No "contact support to unsubscribe"
   patterns.

## Build vs buy — banner SDK

| Option | Self-host | IAB TCF | SSR-friendly | Free-tier | Best for |
|---|---|---|---|---|---|
| **Klaro** (OSS) | ✅ | ⚠️ plugin | ✅ | Unlimited | Default: self-hosted, banner + preferences modal |
| **OneTrust** | ❌ SaaS | ✅ | ⚠️ | Paid | Enterprise; complex regional matrix |
| **Cookiebot** | ❌ SaaS | ✅ | ⚠️ | Tiny free tier | Small-team + regional matrix + IAB needs |
| **Iubenda** | ❌ SaaS | ✅ | ⚠️ | Paid | Legal-docs + banner in one package |
| **Cookieyes / Termly / Complianz** | Mixed | ⚠️ | ⚠️ | Varies | Usually WordPress-heritage, integration debt |
| **Custom + IAB TCF SDK** | ✅ | ✅ | ✅ | n/a | Only if you have specific AdTech needs |

**Default pick: Klaro** (self-hosted OSS). No SaaS subscription, no
data sent to a third party *by the consent tool itself*, full SSR
control, and hook-based gating that fits our architecture. Add IAB
TCF only if AdTech is actually in scope.

**Never build this from scratch.** The spec surface (IAB TCF v2.2
has ~200 purposes and vendors, GPP unifies US state privacy signals,
CCPA requires a specific HTML footer link) is not a weekend project.

## Install

```bash
pnpm add klaro
# If IAB TCF + advertising is in scope:
pnpm add @iabtcf/core @iabtcf/cmpapi
```

## Shape

```text
src/lib/consent/
  categories.ts             # purpose catalog with legal basis per region
  klaro-config.ts           # Klaro config built from categories
  state.ts                  # reactive consent store (SSR + client)
  ssr.ts                    # cookie read in hooks.server.ts
  audit.ts                  # emit → audit-log.md on grant/revoke
  regional.ts               # geo → applicable regulation
src/routes/
  +layout.server.ts         # resolve consent cookie + region server-side
  +layout.svelte            # mount Klaro after SSR hydrate
  privacy/
    +page.svelte            # preferences page (withdrawal path)
    do-not-sell/+page.svelte # CCPA-required footer link target
```

## Category catalog — the authoritative list

```ts
// src/lib/consent/categories.ts
import { z } from 'zod';

export const ConsentCategory = z.enum([
  'essential',          // always-on; not negotiable
  'functional',         // theme, locale
  'analytics',          // aggregate usage; no cross-site
  'advertising',        // targeted ads; cross-context
  'marketing',          // email tracking, product comms
  'replay',             // session replay, heatmaps
  'ai_personalization', // ML profiling, recommendations
]);
export type ConsentCategory = z.infer<typeof ConsentCategory>;

export const CATEGORIES = [
  {
    id: 'essential',
    required: true,
    legalBasis: { gdpr: 'necessary', ccpa: 'necessary' },
    description: 'Session, auth, CSRF, and load-balancing cookies.',
    services: ['session', 'csrf'],
  },
  {
    id: 'functional',
    required: false,
    legalBasis: { gdpr: 'consent', ccpa: 'consent' },
    description: 'Remember your theme and language preferences.',
    services: ['theme-cookie', 'locale-cookie'],
  },
  {
    id: 'analytics',
    required: false,
    legalBasis: { gdpr: 'consent', ccpa: 'opt-out' },
    description: 'Aggregate product usage to improve features.',
    services: ['plausible'],
  },
  {
    id: 'advertising',
    required: false,
    legalBasis: { gdpr: 'consent', ccpa: 'opt-out' },
    description: 'Targeted advertising across sites.',
    services: ['google-ads', 'meta-pixel'],
    tcfVendors: [755, 89],   // IAB vendor IDs
  },
  {
    id: 'marketing',
    required: false,
    legalBasis: { gdpr: 'consent', ccpa: 'opt-out' },
    description: 'Track email opens and link clicks.',
    services: ['postmark-tracking'],
  },
  {
    id: 'replay',
    required: false,
    legalBasis: { gdpr: 'consent', ccpa: 'opt-out' },
    description: 'Anonymized session replay for debugging.',
    services: ['sentry-replay'],
  },
  {
    id: 'ai_personalization',
    required: false,
    legalBasis: { gdpr: 'consent', ccpa: 'consent' },
    description: 'Personalize AI suggestions based on your activity.',
    services: ['ai-profile'],
  },
] as const;
```

**Five catalog rules:**

1. **`essential.required = true` is read-only.** The UI surfaces
   that essential loads unconditionally with no toggle.
2. **`legalBasis.gdpr` distinguishes `necessary` from `consent`.** A
   regulator asks "what's the lawful basis for this data"; this
   field is the documented answer.
3. **One entry per category, not per service.** "Google Analytics"
   isn't a category; analytics is. `services` names what fires
   under the category so gating code checks category, not service.
4. **`tcfVendors`** are IAB TCF vendor IDs for the advertising
   category — only populate when AdTech is in scope.
5. **`ai_personalization` is its own category.** EU AI Act requires
   purpose-specific consent for ML profiling; lumping it into
   "analytics" is a documented enforcement target.

## SSR resolution — consent before first paint

```ts
// src/hooks.server.ts
import { resolveConsent } from '$lib/consent/ssr';

export async function handle({ event, resolve }) {
  event.locals.consent = resolveConsent(event.cookies.get('__Host-consent'));
  event.locals.region = resolveRegion(event.request);
  // …
  return resolve(event);
}
```

```ts
// src/lib/consent/ssr.ts
import { z } from 'zod';
import { CATEGORIES, ConsentCategory } from './categories';

const CookieShape = z.object({
  v: z.literal(1),                                    // schema version
  t: z.number().int(),                                 // timestamp epoch sec
  c: z.record(ConsentCategory, z.boolean()),
  r: z.string().length(2).nullable(),                  // region code at grant
});

export type ConsentState = z.infer<typeof CookieShape>;

export function resolveConsent(raw: string | undefined): ConsentState {
  const defaultState: ConsentState = {
    v: 1,
    t: 0,
    c: Object.fromEntries(CATEGORIES.map((c) => [c.id, c.required])) as Record<ConsentCategory, boolean>,
    r: null,
  };
  if (!raw) return defaultState;
  try {
    const parsed = CookieShape.parse(JSON.parse(raw));
    // Reject if older than 13 months — consent expires per GDPR guidance.
    if (Date.now() / 1000 - parsed.t > 13 * 30 * 86400) return defaultState;
    return parsed;
  } catch {
    return defaultState;
  }
}
```

**Six SSR rules:**

1. **`__Host-consent` prefix.** Browser-enforced no-domain, no-
   subdomain-leak per [cookies-authoritative.md](cookies-authoritative.md).
2. **Schema versioned** (`v: 1`). Migrations possible; a shape
   change that doesn't bump `v` corrupts records.
3. **Default state is all-false except essential.** Unknown or
   missing cookie = no consent granted; never default to "yes".
4. **Expiry is 13 months** (EDPB guidance). After that, re-prompt.
5. **Cookie-parse errors → default state.** A malformed cookie is a
   no-consent state, not an error.
6. **Region at grant stored.** If a user moves from EU to US, the
   original consent was made under GDPR — we don't upgrade/downgrade
   retroactively.

## Regional resolution

```ts
// src/lib/consent/regional.ts
export type Regulation = 'gdpr' | 'ccpa' | 'lgpd' | 'none';

export function resolveRegion(request: Request): {
  country: string | null;
  regulation: Regulation;
} {
  const country = request.headers.get('x-vercel-ip-country')
    ?? request.headers.get('cf-ipcountry')
    ?? null;

  const gdprCountries = new Set([/* EU27 + EEA + UK */]);
  if (country && gdprCountries.has(country)) return { country, regulation: 'gdpr' };
  if (country === 'US-CA' || isCCPAApplicable(request)) return { country, regulation: 'ccpa' };
  if (country === 'BR') return { country, regulation: 'lgpd' };
  return { country, regulation: 'none' };
}
```

**Three regional rules:**

1. **Country header from edge (`x-vercel-ip-country` / `cf-ipcountry`).**
   Never geoip-lookup server-side; it's slow, stale, and handled at
   the edge anyway.
2. **`none` is a valid return** — user is somewhere without specific
   law; show the banner anyway (best practice) but defaults can be
   opt-in-presumed.
3. **CCPA applies beyond California.** If any California resident
   might hit the site, CCPA applies. Default to "yes" when uncertain.

## Banner mount + hydration

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import type { LayoutData } from './$types';

  let { data, children }: { data: LayoutData; children: any } = $props();

  onMount(async () => {
    if (!browser) return;
    // Only load Klaro JS if banner is needed.
    if (data.consent.t === 0) {
      const klaro = await import('klaro');
      const { buildConfig } = await import('$lib/consent/klaro-config');
      klaro.setup(buildConfig(data.region));
      klaro.show();
    }
  });
</script>

{@render children()}
```

**Four mount rules:**

1. **Lazy-import Klaro.** ~40 KB min+gzip; defer until banner is
   actually needed.
2. **Banner only mounts if no consent decision yet** (`t === 0`).
   Users who've already decided don't see the banner again until
   expiry.
3. **SSR renders with the resolved state.** First-paint analytics
   tags gated on `data.consent.c.analytics`; no flash of pre-consent
   tracking.
4. **Klaro setup takes region.** Banner text changes per GDPR vs
   CCPA (opt-in "Accept all" vs opt-out "Do Not Sell").

## Gating third-party scripts

```svelte
<!-- src/routes/+layout.svelte -->
{#if data.consent.c.analytics}
  <script
    src="https://plausible.io/js/plausible.js"
    data-domain="acme.example"
    defer
  ></script>
{/if}
```

**Three gating rules:**

1. **SSR-rendered `{#if}` block, not client-side script injection.**
   Server decides; client sees the DOM or doesn't.
2. **Never a "stub then load" pattern.** No fake `gtag()` function
   that queues calls until consent — that's trackers-before-consent
   in disguise.
3. **Unload on withdrawal.** When consent is revoked mid-session,
   reload the page (or explicitly `removeChild` tags + clear cookies
   they set). Klaro handles the reload prompt.

## Audit + withdrawal

```ts
// src/lib/consent/audit.ts
import { emit as audit } from '@sveltesentio/audit';
import type { ConsentState } from './ssr';

export async function auditConsent(
  previous: ConsentState,
  next: ConsentState,
  source: { requestId: string; userId: string | null; ip: string; userAgent: string },
): Promise<void> {
  const changed = Object.entries(next.c).filter(
    ([k, v]) => previous.c[k as keyof typeof previous.c] !== v,
  );
  for (const [category, granted] of changed) {
    await audit({
      actor: { type: source.userId ? 'user' : 'system', id: source.userId, label: null },
      onBehalfOf: null,
      action: granted ? 'consent.granted' : 'consent.withdrawn',
      target: { type: 'consent_category', id: category, label: null },
      source: {
        ip: anonymizeIp(source.ip),
        userAgent: source.userAgent,
        requestId: source.requestId,
        origin: 'web',
      },
      outcome: 'success',
      reason: null,
      metadata: { region: next.r ?? 'unknown' },
    });
  }
}
```

**Four audit rules:**

1. **Every grant and every withdrawal is an audit event.** This is
   the "proof" half of consent management; a regulator may ask for
   it.
2. **Per-category event, not one event for the whole decision.**
   Granular audit lets you answer "who withdrew advertising on
   2026-02-14" without scanning blobs.
3. **Reuse [audit-log.md](audit-log.md) sink.** Compliance events
   land in the same tamper-evident log as auth/permissions/billing.
4. **`consent.granted` and `consent.withdrawn` are new
   `AuditAction` enum entries** — add them to the schema.

## CCPA "Do Not Sell or Share" link

CCPA requires a specific HTML footer link on every page, visible
without interaction, stable URL:

```svelte
<!-- src/routes/+layout.svelte footer -->
{#if data.region.regulation === 'ccpa'}
  <footer>
    <a href="/do-not-sell">Do Not Sell or Share My Personal Information</a>
  </footer>
{/if}
```

The linked page is a one-click opt-out form, not a menu of
preferences. Every category flagged `ccpa: 'opt-out'` flips to false.

## IAB TCF v2.2 — only if AdTech is actually used

If advertising category loads Google Ads or Meta Pixel, the IAB
Transparency & Consent Framework signals consent to downstream
vendors via a global API:

```ts
// src/lib/consent/tcf.ts
import { CmpApi } from '@iabtcf/cmpapi';

export function exposeTcApi(): void {
  if (typeof window === 'undefined') return;
  const cmpApi = new CmpApi(CMP_ID, CMP_VERSION, false);
  // Set TCString from cookie; update on change.
}
```

Three TCF rules:

1. **Only enable when advertising category is in scope.** An
   EU-visible site with just Plausible analytics does NOT need TCF.
2. **CMP ID comes from IAB registration.** Self-implementations must
   register; off-the-shelf CMPs (OneTrust, Cookiebot) bring their
   own.
3. **Global Privacy Platform (GPP)** is the emerging replacement for
   per-region strings. Plan the migration; don't bake TCF-only.

## Observability — consent rates dashboard

```ts
span.setAttributes({
  'consent.region': region.country ?? 'unknown',
  'consent.regulation': region.regulation,
  'consent.analytics': state.c.analytics,
  'consent.advertising': state.c.advertising,
});

metrics.consentGranted.add(1, {
  category: changed_category,
  region: region.regulation,
});
```

**Three observability rules:**

1. **`consent.*` attributes are booleans** per category — bounded.
2. **Never attach user IDs to consent metrics.** Aggregate-only;
   per-user belongs in audit.
3. **Track drop-off.** "Banner shown but no decision" is a useful
   metric — measures banner friction.

## Testing

```ts
// packages/consent/test/ssr.test.ts
import { describe, expect, test } from 'vitest';
import { resolveConsent } from '../src/ssr';

describe('consent SSR resolution', () => {
  test('no cookie → all false except essential', () => {
    const state = resolveConsent(undefined);
    expect(state.c.essential).toBe(true);
    expect(state.c.analytics).toBe(false);
  });

  test('expired cookie → default state', () => {
    const old = JSON.stringify({ v: 1, t: 0, c: { analytics: true }, r: 'DE' });
    const state = resolveConsent(old);
    expect(state.c.analytics).toBe(false);
  });

  test('malformed cookie → default state, no throw', () => {
    expect(() => resolveConsent('not-json')).not.toThrow();
  });
});
```

Playwright lane: visit `/`, assert banner visible in EU geo, accept
all, reload, assert banner hidden + analytics script present.

## Anti-patterns

- **Don't fire a third-party script before SSR-consent resolves.**
  The "flash of tracking" is a documented GDPR violation; DPAs have
  fined for exactly this.
- **Don't pre-check opt-in boxes in EU.** ePrivacy Directive + GDPR
  + CJEU's *Planet49* ruling — pre-ticked = no consent.
- **Don't treat dismiss as accept.** Closing the banner without a
  choice is not consent. Show the banner again until a decision is
  made.
- **Don't make withdrawal harder than grant.** A "contact support
  to unsubscribe" pattern is a statutory violation.
- **Don't use a SaaS banner that itself loads trackers pre-consent.**
  Some consent-management SaaS products load analytics on their
  admin domain before the banner appears; check the network tab.
- **Don't conflate "cookie banner" with "privacy policy".** The
  banner is the live-consent gate; the policy is the static legal
  disclosure. Both are required.
- **Don't geo-gate the banner to EU-only.** Showing a banner in
  non-GDPR countries is legal and increases trust; hiding it to
  "avoid scaring users" is a false economy.
- **Don't ignore CCPA if you ship globally.** The "Do Not Sell or
  Share" link is mandatory for California visitors; you don't know
  who's visiting without the link being universal or geo-targeted.
- **Don't log PII with consent events.** Audit records the *fact*
  of consent, not the content of the user's interaction with the
  banner. IP anonymized per [audit-log.md](audit-log.md) retention
  policy.
- **Don't rely on Do-Not-Track header.** DNT is legally
  non-binding in most jurisdictions and ignored by most trackers.
  It's not a substitute for explicit consent UI.
- **Don't store consent in localStorage.** localStorage is not sent
  with SSR requests — the banner would flash before the client
  decides. Cookies only, `__Host-` prefixed.
- **Don't use a single "everything" toggle without per-category
  granularity.** GDPR Article 7(4) requires consent be granular per
  purpose. Accept-all / reject-all is fine as a shortcut but
  per-category toggles must exist too.
- **Don't lie about lawful basis.** Marking advertising as
  "legitimate interest" to avoid the consent requirement is a direct
  enforcement target of every EU DPA. Consent, not LI, for tracking.
- **Don't skip the audit trail.** Without per-grant/per-withdrawal
  audit, you have no evidence defending a complaint. The audit log
  is your legal-process artefact.
- **Don't replay the banner on every page load.** Once a decision is
  recorded, respect it until expiry. Banner fatigue is real and
  regulators notice.

## References

- [ADR-0019 — Structured error envelope](../adr/0019-structured-error-envelope.md)
- [principles.md §2.2 — OWASP ASVS L2 V8 (privacy + consent)](../principles.md)
- Sibling recipes: [cookies-authoritative.md](cookies-authoritative.md),
  [audit-log.md](audit-log.md),
  [observability.md](observability.md),
  [feature-flags.md](feature-flags.md),
  [i18n-runtime-strategy.md](i18n-runtime-strategy.md),
  [ai-audit-hook.md](ai-audit-hook.md),
  [trusted-types.md](trusted-types.md),
  [structured-emails.md](structured-emails.md),
  [theming-flash-free.md](theming-flash-free.md).
- Regulation references:
  - GDPR Art. 7 — Conditions for consent: <https://gdpr-info.eu/art-7-gdpr/>
  - EDPB Guidelines 05/2020 on consent: <https://edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-052020-consent-under-regulation-2016679_en>
  - CCPA / CPRA: <https://oag.ca.gov/privacy/ccpa>
  - LGPD (Brazil): <https://iapp.org/resources/article/brazils-general-data-protection-law-english-translation/>
  - Quebec Law 25: <https://www.quebec.ca/en/government/policies-orientations/modernization-privacy-act>
- Technical specs:
  - IAB TCF v2.2: <https://iabeurope.eu/transparency-consent-framework/>
  - IAB Global Privacy Platform: <https://iabtechlab.com/gpp/>
  - Klaro documentation: <https://klaro.org/docs>
  - CJEU *Planet49* (pre-ticked boxes): <https://curia.europa.eu/juris/documents.jsf?num=C-673/17>
