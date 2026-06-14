# Internationalization routing — per-locale URL shape + hreflang + geo-redirect

i18n-runtime is "how messages render"; i18n-routing is "what the URL
looks like." They're adjacent concerns but distinct: Paraglide owns
message resolution, SvelteKit owns URL shape, and the matrix between
them decides whether `example.com/de/produkte` or `example.com/produkte?lang=de`
or `de.example.com/produkte` is canonical. This recipe codifies the
contract: **path-prefix routing as default (`/en/`, `/de/`, `/fr/`),
`hreflang` alternates on every localized page, geo-redirect as soft-
hint not hard-redirect, locale persistence via `__Host-locale` cookie
with signed integrity, and canonical-URL discipline so search engines
index one URL per (locale, page)**.

Per [principles.md §2.3](../principles.md) (WCAG 2.2 AA — language of
page declared) and SEO-hygiene (one canonical URL per content
variant), the posture is: **explicit locale in URL path (never
query-string, never Accept-Language-only)**, **default locale has no
prefix OR has explicit `/en/` prefix (pick one per project, commit)**,
**geo-detection via edge-header is a suggestion not a forced
redirect**, **cookie persists user's explicit choice across sessions**,
**every page declares `<html lang>` + `hreflang` + `canonical`**.

## Related

- [i18n-runtime-strategy.md](i18n-runtime-strategy.md) — Paraglide v2
  message resolution; sibling to this recipe (routing vs runtime).
- [theming.md](theming.md) + [theming-flash-free.md](theming-flash-free.md)
  — cookie-resolution pattern mirrors this recipe's `__Host-locale`.
- [cookies-authoritative.md](cookies-authoritative.md) — `__Host-`
  prefix + `SameSite=Lax` for the locale cookie.
- [caching.md](caching.md) — cached SSR pages MUST `Vary: Cookie`
  when locale depends on cookie; `/de/` path routes naturally
  cache-keyable without `Vary`.
- [safe-area.md](safe-area.md) — RTL locales (ar, he) require
  `dir="rtl"` + logical-property-safe layout.
- [email-deliverability.md](email-deliverability.md) — transactional
  email locale resolved from user preference, not request path.
- [onboarding.md](onboarding.md) — first-run locale selection is an
  onboarding step for ambiguous cases (geo + Accept-Language
  disagree).
- [permissions.md](permissions.md) — admin UI locale is separate
  from tenant-facing locale; user may be an English admin managing
  a German-speaking tenant.
- [observability.md](observability.md) — `i18n.locale` bounded label;
  never raw `Accept-Language`.
- [principles.md §2.3](../principles.md) — WCAG 2.2 AA.

## Four URL-shape options

```text
Option A  Path prefix            example.com/de/produkte          DEFAULT
Option B  Subdomain              de.example.com/produkte          ESCAPE (multi-domain)
Option C  Country TLD            example.de/produkte              enterprise-only
Option D  Query string           example.com/produkte?lang=de     REJECTED
```

**Decision matrix:**

| Factor | A: Path | B: Subdomain | C: ccTLD | D: Query |
|---|---|---|---|---|
| SEO signal strength | strong | strong | strongest (per-country) | weak |
| Single CDN cache keyspace | yes | per-subdomain | per-domain | yes |
| Cookie shared across locales | yes | requires parent-domain cookies | no (separate origins) | yes |
| Setup complexity | low | medium | high | low |
| CORS simplicity | simple | cross-subdomain | cross-origin | simple |
| Canonical-URL discipline | natural | per-subdomain | per-domain | brittle |

**Three URL-shape rules:**

1. **Path-prefix is the default.** Simplest CDN/cookie/CORS story;
   strong SEO signal; single deploy. Escape to subdomain only if
   regulatory (per-country data residency) or enterprise-sales
   (`example.de` brand weight) requires.
2. **Query-string routing is rejected.** `?lang=de` is invisible to
   most crawlers, breaks share-links (users strip unfamiliar
   params), and search engines de-rank it as duplicate content.
3. **Pick default-locale-prefix-or-no once, commit forever.** Either
   `/` and `/de/` (English implicit) OR `/en/` and `/de/` (English
   explicit). Mixing — `/de/produkte` live while `/en/produkte`
   redirects to `/products` — is an SEO catastrophe.

## Locale catalog — bounded enum

```typescript
// src/lib/i18n/locales.ts
import { z } from 'zod';

export const Locale = z.enum(['en', 'de', 'fr', 'es', 'ar', 'ja']);
export type Locale = z.infer<typeof Locale>;

export const DEFAULT_LOCALE: Locale = 'en';

interface LocaleMeta {
  code: Locale;
  name: string;
  nativeName: string;
  dir: 'ltr' | 'rtl';
  region: string | null;
  fallback: Locale;
}

export const LOCALES: Record<Locale, LocaleMeta> = {
  en: { code: 'en', name: 'English', nativeName: 'English', dir: 'ltr', region: null, fallback: 'en' },
  de: { code: 'de', name: 'German', nativeName: 'Deutsch', dir: 'ltr', region: 'DE', fallback: 'en' },
  fr: { code: 'fr', name: 'French', nativeName: 'Français', dir: 'ltr', region: 'FR', fallback: 'en' },
  es: { code: 'es', name: 'Spanish', nativeName: 'Español', dir: 'ltr', region: 'ES', fallback: 'en' },
  ar: { code: 'ar', name: 'Arabic', nativeName: 'العربية', dir: 'rtl', region: null, fallback: 'en' },
  ja: { code: 'ja', name: 'Japanese', nativeName: '日本語', dir: 'ltr', region: 'JP', fallback: 'en' },
};

export function isLocale(value: unknown): value is Locale {
  return Locale.safeParse(value).success;
}
```

**Six catalog rules:**

1. **`Locale` is a bounded Zod enum.** Adding a locale = enum bump
   + message-catalog audit (every `m.*` key has a translation) +
   PR. Free-form strings drift into `en`/`en-US`/`en-GB`
   inconsistency.
2. **ISO 639-1 two-letter codes** as the canonical shape. Region
   suffixes (`en-US`) are reserved for ambiguous cases — most
   products don't need them.
3. **`dir: 'rtl'` surfaces in routing + layout.** RTL locales
   require `<html dir="rtl">` and logical-property CSS; if a
   locale is RTL, lock it into the catalog early.
4. **`fallback` is always a real locale.** If Japanese translation
   is missing for a new string, fall back to English, not to the
   message key. Paraglide's fallback chain reads from the catalog.
5. **`nativeName` is what appears in the language-switcher.** Users
   looking for their language find "Deutsch", not "German."
   Switcher lists native names, grouped/sorted by the *user's
   current* locale (so an en-US user sees them alphabetized by
   English name for scanning, toggled by preference).
6. **`region` is SEO-metadata only, not routing.** Used for
   `hreflang="de-DE"` annotations; the URL itself stays
   `/de/` (ISO-language, not ISO-language-region).

## Reference pattern

### 1. Routing: `[lang]` param group

```text
src/routes/
├── [[lang=locale]]/
│   ├── +layout.server.ts       resolveLocale() + hreflang alternates
│   ├── +layout.svelte          <html lang dir>
│   ├── +page.svelte            home
│   ├── products/
│   │   └── +page.svelte
│   └── about/
│       └── +page.svelte
├── api/                         API routes locale-independent
└── hooks.server.ts              geo-redirect (soft)
```

```typescript
// src/params/locale.ts
import type { ParamMatcher } from '@sveltejs/kit';
import { isLocale } from '$lib/i18n/locales';

export const match: ParamMatcher = (param) => isLocale(param);
```

**Five routing rules:**

1. **`[[lang=locale]]` optional-parameter group** — wraps the entire
   i18n-scoped site. The `locale` param-matcher rejects non-locale
   values at the router, so `/nonexistent` 404s cleanly rather
   than treating `nonexistent` as a locale.
2. **Optional bracket `[[...]]` allows default-locale-without-
   prefix.** `/products` renders English; `/de/products` renders
   German. Pick this OR explicit-prefix-for-all (`/en/products`
   + `/de/products`), not both.
3. **API routes are OUTSIDE the locale group.** `POST /api/orders`
   never has a locale prefix; the user's locale is resolved from
   session/cookie/header server-side.
4. **Static files outside the locale group.** `/favicon.ico`,
   `/robots.txt`, `/sitemap.xml` are origin-scoped, not locale-
   scoped. (sitemap lists all locale variants.)
5. **Admin routes are in their own group.** `/(admin)/...` without
   locale prefix — admins work in their own UI language
   regardless of which tenant they're viewing.

### 2. Locale resolution — the precedence chain

```typescript
// src/lib/i18n/resolve.ts
import type { Cookies } from '@sveltejs/kit';
import { Locale, DEFAULT_LOCALE, isLocale } from './locales';

interface ResolveInput {
  urlParam: string | undefined;
  cookie: string | undefined;
  acceptLanguage: string | null;
  geoCountry: string | null;
}

export function resolveLocale(input: ResolveInput): Locale {
  if (input.urlParam && isLocale(input.urlParam)) return input.urlParam;

  if (input.cookie && isLocale(input.cookie)) return input.cookie;

  if (input.acceptLanguage) {
    const parsed = parseAcceptLanguage(input.acceptLanguage);
    for (const tag of parsed) {
      const base = tag.split('-')[0];
      if (isLocale(base)) return base;
    }
  }

  if (input.geoCountry) {
    const geo = countryToLocale(input.geoCountry);
    if (geo) return geo;
  }

  return DEFAULT_LOCALE;
}
```

**Five precedence rules:**

1. **URL wins.** If `urlParam === 'de'`, the page is German. Period.
   User followed a `/de/...` link; honor it.
2. **Cookie is second.** The `__Host-locale` cookie reflects the
   user's last explicit choice (via the switcher). If URL is
   default (no prefix) and cookie says `de`, redirect to `/de/...`
   (see rule 4).
3. **Accept-Language is third.** Parse `q=` weights; pick the
   highest-priority locale we support. Fall through if none match.
4. **Geo-country is fourth, and soft.** `DE` IP suggests `de` but
   this is a redirect *once*, not a forced shape. User who clicks
   an English link from Germany should see English.
5. **DEFAULT_LOCALE last.** Never throw "unresolvable locale"; the
   default is the floor.

### 3. `+layout.server.ts` — hreflang + canonical

```typescript
// src/routes/[[lang=locale]]/+layout.server.ts
import type { LayoutServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { resolveLocale } from '$lib/i18n/resolve';
import { LOCALES, DEFAULT_LOCALE } from '$lib/i18n/locales';
import { PUBLIC_ORIGIN } from '$env/static/public';

export const load: LayoutServerLoad = async ({ params, cookies, request, url }) => {
  const geoCountry = request.headers.get('x-vercel-ip-country')
    ?? request.headers.get('cf-ipcountry');

  const resolved = resolveLocale({
    urlParam: params.lang,
    cookie: cookies.get('__Host-locale'),
    acceptLanguage: request.headers.get('accept-language'),
    geoCountry,
  });

  if (!params.lang && resolved !== DEFAULT_LOCALE) {
    throw redirect(303, `/${resolved}${url.pathname}${url.search}`);
  }

  const pathWithoutLang = params.lang
    ? url.pathname.replace(`/${params.lang}`, '') || '/'
    : url.pathname;

  const alternates = Object.values(LOCALES).map((locale) => ({
    locale: locale.code,
    hreflang: locale.region ? `${locale.code}-${locale.region}` : locale.code,
    href: locale.code === DEFAULT_LOCALE
      ? `${PUBLIC_ORIGIN}${pathWithoutLang}`
      : `${PUBLIC_ORIGIN}/${locale.code}${pathWithoutLang}`,
  }));

  const canonical = resolved === DEFAULT_LOCALE
    ? `${PUBLIC_ORIGIN}${pathWithoutLang}`
    : `${PUBLIC_ORIGIN}/${resolved}${pathWithoutLang}`;

  return {
    locale: resolved,
    dir: LOCALES[resolved].dir,
    alternates,
    canonical,
  };
};
```

**Seven metadata rules:**

1. **Redirect 303 on locale mismatch** — if user's cookie/Accept-
   Language says `de` but URL has no prefix, move them to `/de/`.
   One-time per session (then cookie matches, no further redirects).
2. **`hreflang` must be present on EVERY localized page**, not just
   the homepage. Each `<link rel="alternate" hreflang>` tag needs
   a return-link from the target page (bidirectional — Google
   requires it).
3. **`hreflang="x-default"`** on the fallback locale's URL —
   signals "use this when no locale matches." Usually the default
   locale's homepage or a locale-selector page.
4. **`canonical` is self-referential per locale.** `/de/produkte`'s
   canonical is `https://example.com/de/produkte`, not the English
   URL. Otherwise Google treats `/de/produkte` as duplicate of
   `/products` and drops it.
5. **`pathWithoutLang` is the stripped path**, used to construct
   alternates. `/de/produkte` → `/produkte` stripped → `/` prefix
   per-locale reapplied.
6. **Region suffix in `hreflang` only when it disambiguates.**
   `de-DE` vs `de-AT` matters for German markets; plain `de`
   is fine if you serve one German variant.
7. **`alternates` includes `x-default` entry.** Some SEO linters
   fail the sitemap without it.

### 4. `+layout.svelte` — `<html lang dir>` + SEO markup

```svelte
<!-- src/routes/[[lang=locale]]/+layout.svelte -->
<script lang="ts">
  import { page } from '$app/stores';
  import { setLocale } from '$paraglide/runtime';
  import type { LayoutData } from './$types';

  let { data, children }: { data: LayoutData; children: any } = $props();

  $effect.pre(() => {
    setLocale(data.locale);
  });
</script>

<svelte:head>
  <link rel="canonical" href={data.canonical} />
  {#each data.alternates as alt}
    <link rel="alternate" hreflang={alt.hreflang} href={alt.href} />
  {/each}
  <link rel="alternate" hreflang="x-default" href={data.alternates[0].href} />
</svelte:head>

<svelte:html lang={data.locale} dir={data.dir} />

{@render children()}
```

**Five markup rules:**

1. **`<svelte:html lang>` + `dir`** on every page, driven by
   server-resolved data. Screen readers switch pronunciation
   based on `lang`; RTL layouts depend on `dir`.
2. **`<link rel="canonical">` on every page** — including the
   homepage. SEO debuggers flag missing canonicals as a warning.
3. **`<link rel="alternate">` loop emits one per locale**, plus
   the `x-default` variant. Omitting a locale hides it from
   search engines for this URL.
4. **`$effect.pre()` for Paraglide `setLocale`** — runs before
   render, so all `m.*` calls use the correct locale on first
   paint. Too-late activation causes flash-of-wrong-language.
5. **Don't manipulate `document.documentElement.lang` in
   `$effect`.** `<svelte:html>` handles it SSR-first; `$effect`
   runs post-hydration, causing FOUC-for-SR-users.

### 5. Geo-redirect: once, soft, cookie-persisted

```typescript
// src/hooks.server.ts
import type { Handle } from '@sveltejs/kit';
import { isLocale } from '$lib/i18n/locales';
import { countryToLocale } from '$lib/i18n/resolve';

export const handle: Handle = async ({ event, resolve }) => {
  const hasLocalePrefix = /^\/[a-z]{2}(\/|$)/.test(event.url.pathname);
  const geoRedirected = event.cookies.get('geo_redirected');
  const manualLocale = event.cookies.get('__Host-locale');

  if (!hasLocalePrefix && !geoRedirected && !manualLocale) {
    const geoCountry = event.request.headers.get('x-vercel-ip-country')
      ?? event.request.headers.get('cf-ipcountry');
    const suggested = geoCountry ? countryToLocale(geoCountry) : null;

    event.cookies.set('geo_redirected', '1', {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
      secure: true,
      httpOnly: true,
    });

    if (suggested && suggested !== 'en') {
      return new Response(null, {
        status: 303,
        headers: { location: `/${suggested}${event.url.pathname}${event.url.search}` },
      });
    }
  }

  return resolve(event);
};
```

**Six geo-redirect rules:**

1. **Only redirect first-visit-without-manual-choice.** The
   `geo_redirected` flag ensures we suggest exactly once; user's
   subsequent manual choice (cookie) wins over geo forever.
2. **Only redirect to NON-default locale.** An `en` geo result is
   already served at `/`; no redirect needed. Also prevents
   /en/→/ bounce loops.
3. **Don't redirect crawlers.** Check `user-agent` for `googlebot`
   / `bingbot` / common crawlers; serve without redirect. Google
   explicitly says geo-redirects hurt indexing if crawlers can't
   see all locales.
4. **`sameSite: 'lax'` not `strict`** — the cookie must survive
   cross-site navigations (user clicks link from Google results).
5. **`secure: true` always** — even the geo-marker cookie.
6. **Language-switcher sets `__Host-locale`.** Manual choice
   bypasses the geo-suggestion forever. Don't set `geo_redirected`
   from the switcher; set the authoritative cookie.

### 6. Language switcher component

```svelte
<!-- src/lib/components/LocaleSwitcher.svelte -->
<script lang="ts">
  import { page } from '$app/stores';
  import { LOCALES } from '$lib/i18n/locales';
  import * as m from '$paraglide/messages';
  import type { Locale } from '$lib/i18n/locales';

  let { current }: { current: Locale } = $props();

  function switchTo(target: Locale): string {
    const pathWithoutLang = $page.url.pathname.replace(/^\/[a-z]{2}(\/|$)/, '/');
    return target === 'en' ? pathWithoutLang : `/${target}${pathWithoutLang}`;
  }
</script>

<form method="POST" action="/api/i18n/set-locale">
  <label for="locale-select" class="sr-only">{m.locale_switcher_label()}</label>
  <select id="locale-select" name="locale" onchange={(e) => location.href = switchTo(e.currentTarget.value as Locale)}>
    {#each Object.values(LOCALES) as locale}
      <option value={locale.code} selected={locale.code === current}>
        {locale.nativeName}
      </option>
    {/each}
  </select>
  <noscript>
    <button type="submit">{m.locale_switcher_submit()}</button>
  </noscript>
</form>
```

```typescript
// src/routes/api/i18n/set-locale/+server.ts
import type { RequestHandler } from './$types';
import { redirect } from '@sveltejs/kit';
import { isLocale } from '$lib/i18n/locales';

export const POST: RequestHandler = async ({ request, cookies, url }) => {
  const form = await request.formData();
  const locale = form.get('locale');
  const next = form.get('next')?.toString() ?? '/';

  if (!isLocale(locale)) throw redirect(303, '/');

  cookies.set('__Host-locale', locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    secure: true,
    httpOnly: false,
  });

  const targetPath = locale === 'en'
    ? next.replace(/^\/[a-z]{2}(\/|$)/, '/')
    : `/${locale}${next.replace(/^\/[a-z]{2}(\/|$)/, '/')}`;

  throw redirect(303, targetPath);
};
```

**Six switcher rules:**

1. **Switcher is a form, not a link.** Setting a cookie requires
   a server round-trip. Client-only state doesn't persist.
2. **`<noscript>` fallback with submit button** — keyboard-only
   and no-JS users still switch via server action.
3. **`__Host-locale` cookie attributes**: `__Host-` prefix (origin-
   locked), `sameSite: 'lax'`, `secure`, NOT `httpOnly` so
   client-side reads are possible for things like theme+locale
   coherence (but we still resolve server-side as authoritative).
4. **`maxAge: 1 year`** — users don't want to re-pick every
   session. Re-prompt logic (if it exists at all) belongs in a
   cron that emails "still right?" not in the cookie.
5. **Language names in *native* script.** `Deutsch` not `German`.
   Users looking for their language pattern-match their own
   script.
6. **`<label class="sr-only">` for SR users** — the select has no
   visible label typically; screen readers need one.

## Per-locale content gating

Some pages don't exist in every locale — legal docs, region-
specific products, launch-staggered features. Three options:

1. **Fallback to default locale's page** (bad: URL says `/de/` but
   content is English; users confused; SEO duplicate).
2. **404 for missing-locale page** (honest; hurts crawl coverage
   if handled poorly).
3. **Redirect to available-locale variant, announce in UI** (best:
   user reaches content; banner says "This page is only available
   in English").

Implementation:

```typescript
// src/routes/[[lang=locale]]/legal/terms/+page.server.ts
import { redirect } from '@sveltejs/kit';

const TERMS_LOCALES = new Set(['en', 'de']);

export const load: PageServerLoad = async ({ parent }) => {
  const { locale } = await parent();

  if (!TERMS_LOCALES.has(locale)) {
    throw redirect(303, '/legal/terms?reason=not_localized');
  }

  return { locale };
};
```

**Three content-gating rules:**

1. **Bounded per-route locale catalog** — `TERMS_LOCALES` as a
   typed set. New translation = PR.
2. **Redirect with `?reason` query-param** — the target page
   renders an acknowledgment banner (`m.content_not_localized()`)
   so the redirect isn't silent.
3. **`hreflang` alternates only list ACTUALLY-translated pages.**
   A missing translation → exclude from alternates for that page.
   Don't list `/ja/legal/terms` if it redirects away.

## Sitemap generation

```typescript
// src/routes/sitemap.xml/+server.ts
import { PUBLIC_ORIGIN } from '$env/static/public';
import { LOCALES, DEFAULT_LOCALE } from '$lib/i18n/locales';

const ROUTES = ['/', '/about', '/products', '/pricing'];

export const GET: RequestHandler = () => {
  const urls = ROUTES.flatMap((path) =>
    Object.values(LOCALES).map((locale) => {
      const url = locale.code === DEFAULT_LOCALE
        ? `${PUBLIC_ORIGIN}${path}`
        : `${PUBLIC_ORIGIN}/${locale.code}${path}`;

      const alternates = Object.values(LOCALES).map((alt) => {
        const altUrl = alt.code === DEFAULT_LOCALE
          ? `${PUBLIC_ORIGIN}${path}`
          : `${PUBLIC_ORIGIN}/${alt.code}${path}`;
        const hreflang = alt.region ? `${alt.code}-${alt.region}` : alt.code;
        return `<xhtml:link rel="alternate" hreflang="${hreflang}" href="${altUrl}"/>`;
      }).join('');

      return `<url><loc>${url}</loc>${alternates}</url>`;
    }),
  ).join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls}</urlset>`;

  return new Response(xml, { headers: { 'content-type': 'application/xml' } });
};
```

**Three sitemap rules:**

1. **Every URL lists every locale variant via `xhtml:link`.** This
   is the canonical SEO pattern — crawlers read it to discover
   all variants without following redirects.
2. **Regenerate on deploy, not on-demand.** Sitemap is a build
   artifact or periodic cron; runtime generation per-request
   wastes cycles.
3. **Cache headers: `public, max-age=3600, stale-while-revalidate=86400`.**
   Sitemap changes at deploy frequency; hourly is plenty.

## Testing — three lanes

```typescript
it('redirects /de/produkte to /produkte when cookie is en', async () => {
  const res = await app.request('/de/products', { headers: { cookie: '__Host-locale=en' } });
  expect(res.status).toBe(200); // URL wins over cookie
});

it('cookie de + no URL prefix redirects to /de/', async () => {
  const res = await app.request('/products', {
    headers: { cookie: '__Host-locale=de' },
  });
  expect(res.status).toBe(303);
  expect(res.headers.get('location')).toBe('/de/products');
});

it('canonical is self-referential per locale', async () => {
  const enRes = await app.request('/products');
  const deRes = await app.request('/de/products');

  expect(await enRes.text()).toContain('<link rel="canonical" href="https://example.com/products"');
  expect(await deRes.text()).toContain('<link rel="canonical" href="https://example.com/de/products"');
});

it('hreflang alternates are bidirectional', async () => {
  const enHtml = await (await app.request('/products')).text();
  const deHtml = await (await app.request('/de/products')).text();

  expect(enHtml).toContain('hreflang="de" href="https://example.com/de/products"');
  expect(deHtml).toContain('hreflang="en" href="https://example.com/products"');
});
```

**Four test rules:**

1. **Precedence-chain table test** — URL > cookie > AL > geo >
   default, exhaustive. Easy to regress when tweaking
   `resolveLocale`.
2. **Bidirectional-hreflang test** — regression here hides from
   users but tanks SEO; catch before merge.
3. **Canonical-self-referential test** — prevents "duplicate
   content" misconfiguration that deindexes whole locales.
4. **Crawler-detection test** — bot user-agent doesn't trigger
   geo-redirect.

## Observability

```text
Attribute              Values
──────────────────────────────────────────────────────
i18n.locale            bounded Locale enum
i18n.resolution        'url' | 'cookie' | 'accept_language' | 'geo' | 'default'
i18n.geo_country       bounded country-code enum (ISO 3166-1 alpha-2)

Metrics
──────────────────────────────────────────────────────
i18n.page_view.count          counter, labels: locale
i18n.locale_switch.count      counter, labels: from, to
i18n.geo_redirect.count       counter, labels: from_country, to_locale
```

**Four observability rules:**

1. **`i18n.locale` bounded** — never `raw Accept-Language string`
   as a label (unbounded cardinality + PII-ish).
2. **Switch-source tracking** catches "users keep switching from
   German to English on `/produkte`" → translation quality
   problem.
3. **Geo-redirect counter** shows redirect volume; sustained high
   rate with high bounce = geo mismatch for real users (IT
   departments routing via foreign VPN exit nodes).
4. **Per-locale LCP/INP bucketing** via RUM — catches region-
   specific perf issues (German fonts heavier, Arabic shaping
   slower).

## Anti-patterns

1. **Query-string routing `?lang=de`.** Crawlers ignore it; link-
   sharing strips it; treated as duplicate content.
2. **Accept-Language-only routing.** URL is canonical; content
   depends on invisible header. Same URL renders different
   content per user → caching nightmare + SEO disaster.
3. **Forced geo-redirect always.** User on VPN from DE to en-US
   work content gets sent to `/de/` every visit. Soft-once,
   cookie-persist.
4. **`hreflang` on homepage only.** Every localized page needs
   alternates; otherwise Google may conflate product pages.
5. **One-way `hreflang`.** `/en/about` lists `/de/about` but not
   vice versa → Google ignores both.
6. **Mixing default-no-prefix and default-with-prefix.** `/` and
   `/en/` both serve English but one canonical wins; the other
   becomes duplicate content unless explicitly redirected.
7. **Locale in subdomain + cookie fragmented.** `de.example.com`
   cookies don't reach `example.com` without explicit domain
   scope; users toggle locale and lose everything else.
8. **No `<html lang>` or `<html dir>`.** Screen readers fall back
   to browser default; RTL layouts break visually.
9. **Missing `x-default` hreflang.** SEO linters flag; Google
   loses the "when in doubt, show this" fallback.
10. **Locale change via client-only state.** Refresh → locale
    reset; deep-link share → wrong language. Server-resolved
    via cookie is authoritative.
11. **`lang` attribute without validation.** `<html lang="DE">`
    vs `<html lang="de">` — ISO 639-1 is lowercase; uppercase
    is ISO 3166-1 region code. Mixing fails SR pronunciation.
12. **Sitemap without `xhtml:link` alternates.** Crawlers treat
    each locale variant as separate; missed-discovery for
    untranslated routes.
13. **Redirecting crawlers by geo.** Googlebot comes from US
    IPs; a forced `/` → `/de/` for "European" crawlers loses
    German indexing entirely.
14. **`dir="rtl"` as a class, not an attribute.** CSS logical
    properties key off the `dir` attribute; class-based
    RTL-emulation breaks browser-native bidi.
15. **No locale in email templates.** User sets locale to
    German; password-reset arrives in English. Email's locale
    is the user's preference, not the request context.
16. **Translation-key leak in prod.** Missing translation
    renders `profile.title` literally. Paraglide's fallback +
    CI-block-on-missing-keys via [i18n-runtime-strategy.md](i18n-runtime-strategy.md).

## References

- [ADR-0017 — i18n-runtime](../adr/0017-i18n-runtime.md) — Paraglide
  choice; sibling to this recipe's routing decisions.
- [ADR-0040 — logical-properties-safe layout](../adr/0040-logical-properties.md) — RTL + i18n layout.
- [i18n-runtime-strategy.md](i18n-runtime-strategy.md) — message
  authoring + Paraglide runtime.
- [cookies-authoritative.md](cookies-authoritative.md) — `__Host-`
  cookie attributes.
- [caching.md](caching.md) — `Vary: Cookie` considerations.
- [observability.md](observability.md) — bounded `i18n.locale`.
- [Google Search Central — hreflang](https://developers.google.com/search/docs/specialty/international/localized-versions) — canonical SEO guidance.
- [RFC 5646 — Language Tags](https://datatracker.ietf.org/doc/html/rfc5646) — BCP 47 for locale tags.
- [W3C Internationalization — HTML lang attribute](https://www.w3.org/International/questions/qa-html-language-declarations) — `lang` discipline.
- [MDN — hreflang](https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/hreflang) — spec reference.
