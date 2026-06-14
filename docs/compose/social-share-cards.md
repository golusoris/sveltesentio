# social-share-cards.md — composition recipe

> **Open Graph + X (Twitter) Card + dynamic OG-image generation for
> sveltesentio:** static `<meta>` tags via SvelteKit `+layout.svelte` /
> per-route `+page.ts` `head`, **dynamic 1200×630 PNG generation** via
> `@vercel/og` (satori under the hood — Svelte/JSX-flavored markup
> renders to PNG without a headless browser), **per-route override**
> contract, **meta-tag validation** via the `metatags` Zod schema,
> **canonical URLs**, **per-locale variants** (per
> [internationalization-routing.md](internationalization-routing.md)),
> **fallback** when an image-generation endpoint fails. Per
> [ADR-0005](../adr/0005-tailwind-4.md) +
> [ADR-0023](../adr/0023-observability-uuidv7.md) every dynamically
> rendered image is **content-addressed** (URL contains a SHA-256 of
> the inputs) so CDN caches it forever and the route is idempotent.

The default surface is the static `<meta>` tags shipped via
SvelteKit's `+layout.svelte` `<svelte:head>`. The dynamic-OG-image
endpoint is opt-in for routes where pre-rendered images are not
feasible (user-generated content titles, leaderboard-style cards).

## Related

- [image-optimization.md](image-optimization.md) — sibling pipeline
  for content images; OG cards live in their own `/og/` namespace
- [internationalization-routing.md](internationalization-routing.md) —
  `og:locale` + `og:locale:alternate` + per-locale image variants
- [trusted-types.md](trusted-types.md) — meta-tag values must be HTML-
  escaped to avoid `"<script>"`-in-title injection
- [caching.md](caching.md) — OG images are immutable + content-
  addressed; cache 1 year
- [observability.md](observability.md) — OG render time + error rate
  feed Sentry
- [rate-limiting.md](rate-limiting.md) — `/api/og/[hash].png` is
  rate-limited per IP to prevent enumeration DoS
- [pwa.md](pwa.md) — OG image cannot be the app icon; service worker
  precaches `apple-touch-icon.png` separately
- [analytics.md](analytics.md) — UTM-decorated canonical links land
  here
- [ADR-0005](../adr/0005-tailwind-4.md) — token + font sources
- [ADR-0023](../adr/0023-observability-uuidv7.md) — UUIDv7 scheme

## When to use what

```text
Marketing page with a designed hero                 → static OG image (committed PNG)
Blog post with title + author + cover               → dynamic OG via @vercel/og
Public profile page (display name + avatar)         → dynamic OG
Dashboard / authenticated route                     → NO OG image (set noindex)
                                                       sharing private URLs is anti-pattern
Per-locale variant                                  → dynamic OG with locale param
A/B test variants of OG image                       → static (committed) per variant
                                                       avoid dynamic A/B for cacheability
Open Graph audio / video                            → out of scope (rare; use og:video tags)
```

## Spec invariants — what every page emits

```text
<meta name="description"            content="..." />
<meta name="theme-color"            content="#xxx" />

<link rel="canonical"               href="https://example.com/path" />

<!-- Open Graph (Facebook + LinkedIn + most others) -->
<meta property="og:title"           content="..." />
<meta property="og:description"     content="..." />
<meta property="og:type"            content="website|article|profile" />
<meta property="og:url"             content="https://example.com/path" />
<meta property="og:image"           content="https://cdn.../og/abc.png" />
<meta property="og:image:width"     content="1200" />
<meta property="og:image:height"    content="630" />
<meta property="og:image:alt"       content="..." />
<meta property="og:locale"          content="en_US" />
<meta property="og:locale:alternate" content="de_DE" />

<!-- Twitter / X — falls back to og:* but card type must be explicit -->
<meta name="twitter:card"           content="summary_large_image" />
<meta name="twitter:title"          content="..." />
<meta name="twitter:description"    content="..." />
<meta name="twitter:image"          content="https://cdn.../og/abc.png" />
<meta name="twitter:image:alt"      content="..." />
```

Hard sizes (do not break):

- **1200 × 630** — Open Graph + X large card (1.91:1 ratio).
- **600 × 600** — X summary card (square).
- **<= 5 MB** per image; PNG or JPEG.
- **Description**: 50–160 chars (search snippets cut at ~155).
- **Title**: 30–60 chars.

## Install

```bash
pnpm add -F <app> @vercel/og
# Optional: yoga-wasm-web is dragged in by satori — pin if needed.
```

Note: `@vercel/og` works on Node + edge runtimes. SvelteKit Node
adapter ships it as a regular dependency; Cloudflare adapter needs
the `edge` import path.

## Shape — bounded Zod for meta + OG inputs

```ts
// src/lib/social/types.ts
import { z } from 'zod';

export const Locale = z.enum(['en_US', 'en_GB', 'de_DE', 'fr_FR', 'es_ES', 'pt_BR', 'ja_JP']);

export const Meta = z.object({
  title: z.string().min(1).max(60),
  description: z.string().min(20).max(160),
  canonical: z.string().url(),
  themeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  noindex: z.boolean().default(false),
  ogType: z.enum(['website', 'article', 'profile']).default('website'),
  locale: Locale.default('en_US'),
  alternateLocales: z.array(Locale).max(20).default([]),
  // Image is required EXCEPT for noindex pages.
  image: z.object({
    url: z.string().url(),
    alt: z.string().min(1).max(420),
    width: z.literal(1200),
    height: z.literal(630),
  }).nullable(),
  // Twitter handles (optional)
  twitter: z.object({
    site: z.string().regex(/^@[A-Za-z0-9_]{1,15}$/).optional(),
    creator: z.string().regex(/^@[A-Za-z0-9_]{1,15}$/).optional(),
  }).default({}),
});
export type Meta = z.infer<typeof Meta>;

// Inputs to the dynamic OG endpoint — bounded so URLs hash deterministically.
export const OgInputs = z.object({
  v: z.literal(1),                  // schema version, bump on layout change
  template: z.enum(['default', 'article', 'profile', 'event']),
  title: z.string().min(1).max(120),
  subtitle: z.string().max(160).optional(),
  authorName: z.string().max(80).optional(),
  authorAvatarUrl: z.string().url().optional(),
  badgeText: z.string().max(40).optional(),
  locale: Locale.default('en_US'),
  // Theme — `dark` | `light` only; per-tenant theming reuses brand
  // tokens (see tenant-theming.md) but the OG renderer normalizes.
  theme: z.enum(['light', 'dark']).default('light'),
});
export type OgInputs = z.infer<typeof OgInputs>;
```

## Reference patterns

### 1. Static `<svelte:head>` per route

```svelte
<!-- src/routes/blog/[slug]/+page.svelte -->
<script lang="ts">
  import { renderMetaTags } from '$lib/social/render';
  let { data } = $props();
  const meta = $derived(data.meta); // typed as Meta
</script>

<svelte:head>
  {@html renderMetaTags(meta)}
</svelte:head>
```

```ts
// src/lib/social/render.ts
import { Meta } from './types';
import { escapeHtml } from './escape';

export function renderMetaTags(input: unknown): string {
  const meta = Meta.parse(input);
  const e = escapeHtml;
  const lines: string[] = [];

  lines.push(`<title>${e(meta.title)}</title>`);
  lines.push(`<meta name="description" content="${e(meta.description)}" />`);
  lines.push(`<meta name="theme-color" content="${meta.themeColor}" />`);
  lines.push(`<link rel="canonical" href="${e(meta.canonical)}" />`);

  if (meta.noindex) {
    lines.push(`<meta name="robots" content="noindex,nofollow" />`);
    return lines.join('\n');
  }

  lines.push(`<meta property="og:title" content="${e(meta.title)}" />`);
  lines.push(`<meta property="og:description" content="${e(meta.description)}" />`);
  lines.push(`<meta property="og:type" content="${meta.ogType}" />`);
  lines.push(`<meta property="og:url" content="${e(meta.canonical)}" />`);
  lines.push(`<meta property="og:locale" content="${meta.locale}" />`);
  for (const alt of meta.alternateLocales) {
    lines.push(`<meta property="og:locale:alternate" content="${alt}" />`);
  }
  if (meta.image) {
    lines.push(`<meta property="og:image" content="${e(meta.image.url)}" />`);
    lines.push(`<meta property="og:image:width" content="${meta.image.width}" />`);
    lines.push(`<meta property="og:image:height" content="${meta.image.height}" />`);
    lines.push(`<meta property="og:image:alt" content="${e(meta.image.alt)}" />`);
    lines.push(`<meta name="twitter:card" content="summary_large_image" />`);
    lines.push(`<meta name="twitter:image" content="${e(meta.image.url)}" />`);
    lines.push(`<meta name="twitter:image:alt" content="${e(meta.image.alt)}" />`);
  }
  lines.push(`<meta name="twitter:title" content="${e(meta.title)}" />`);
  lines.push(`<meta name="twitter:description" content="${e(meta.description)}" />`);
  if (meta.twitter.site) lines.push(`<meta name="twitter:site" content="${meta.twitter.site}" />`);
  if (meta.twitter.creator) lines.push(`<meta name="twitter:creator" content="${meta.twitter.creator}" />`);

  return lines.join('\n');
}
```

```ts
// src/lib/social/escape.ts
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!));
}
```

The `escapeHtml` step is non-negotiable. A blog title containing
`"><script>alert(1)</script>` becomes a stored XSS without it.

### 2. Dynamic OG image endpoint

```ts
// src/routes/api/og/[hash]/+server.ts
import { ImageResponse } from '@vercel/og';
import { OgInputs } from '$lib/social/types';
import { error } from '@sveltejs/kit';
import { renderOgTemplate } from '$lib/social/templates';

export const config = { isr: { expiration: false } }; // immutable

export async function GET({ url, params, fetch }) {
  // The hash binds inputs; if it doesn't match, refuse.
  const inputsParam = url.searchParams.get('i');
  if (!inputsParam) throw error(400, 'missing inputs');

  const decoded = JSON.parse(atob(inputsParam));
  const parsed = OgInputs.safeParse(decoded);
  if (!parsed.success) throw error(422, 'invalid inputs');

  // Verify hash matches — content-addressed contract.
  const expectedHash = await sha256(JSON.stringify(parsed.data));
  if (expectedHash.slice(0, 16) !== params.hash) throw error(404);

  // Load fonts (cached at module scope in production).
  const [interRegular, interBold] = await Promise.all([
    fetch('/fonts/Inter-Regular.ttf').then(r => r.arrayBuffer()),
    fetch('/fonts/Inter-Bold.ttf').then(r => r.arrayBuffer()),
  ]);

  const element = renderOgTemplate(parsed.data);

  return new ImageResponse(element, {
    width: 1200,
    height: 630,
    fonts: [
      { name: 'Inter', data: interRegular, weight: 400, style: 'normal' },
      { name: 'Inter', data: interBold,    weight: 700, style: 'normal' },
    ],
    headers: {
      // Content-addressed → cache forever.
      'Cache-Control': 'public, max-age=31536000, immutable',
      // Don't let scrapers crawl the API endpoint endlessly.
      'X-Robots-Tag': 'noindex',
    },
  });
}
```

### 3. The OG template (JSX-flavored — satori reads React-like trees)

```tsx
// src/lib/social/templates.tsx
// satori renders a subset of JSX → SVG → PNG. NOT React; just trees.
import type { OgInputs } from './types';

export function renderOgTemplate(input: OgInputs) {
  const bg = input.theme === 'dark' ? '#0a0a0a' : '#ffffff';
  const fg = input.theme === 'dark' ? '#fafafa' : '#0a0a0a';
  const muted = input.theme === 'dark' ? '#a3a3a3' : '#525252';

  return {
    type: 'div',
    props: {
      style: {
        width: '1200px', height: '630px', display: 'flex', flexDirection: 'column',
        background: bg, color: fg, padding: '64px', fontFamily: 'Inter',
      },
      children: [
        input.badgeText && {
          type: 'div',
          props: {
            style: { fontSize: 22, color: muted, marginBottom: 24, textTransform: 'uppercase', letterSpacing: '0.1em' },
            children: input.badgeText,
          },
        },
        {
          type: 'div',
          props: {
            style: { fontSize: 72, fontWeight: 700, lineHeight: 1.1, marginBottom: 24 },
            children: input.title,
          },
        },
        input.subtitle && {
          type: 'div',
          props: {
            style: { fontSize: 32, color: muted, lineHeight: 1.3 },
            children: input.subtitle,
          },
        },
        {
          type: 'div',
          props: {
            style: { marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 16 },
            children: [
              input.authorAvatarUrl && {
                type: 'img',
                props: { src: input.authorAvatarUrl, width: 64, height: 64, style: { borderRadius: '50%' } },
              },
              input.authorName && {
                type: 'div',
                props: { style: { fontSize: 28 }, children: input.authorName },
              },
            ].filter(Boolean),
          },
        },
      ].filter(Boolean),
    },
  };
}
```

Satori restrictions you will hit:

- **Flexbox only** — no grid, no float, no absolute positioning beyond
  `position: 'absolute'`.
- **No CSS variables.** Inline values.
- **`display: 'flex'` is the default for divs with multiple children.**
  Satori warns if missing.
- **Fonts must be passed in.** No `@font-face`, no Google Fonts URL.
- **Images must be reachable** during render — pre-fetch and pass as
  base64 if the source is gated.
- **Emoji** needs an emoji font (Twemoji) explicitly registered.

### 4. URL builder — content-addressed

```ts
// src/lib/social/og-url.ts
import { OgInputs } from './types';

export async function ogImageUrl(rawInputs: OgInputs): Promise<string> {
  const inputs = OgInputs.parse(rawInputs); // throws if invalid
  const json = JSON.stringify(inputs);
  const hash = (await sha256(json)).slice(0, 16);
  const i = btoa(json);
  return `https://cdn.example.com/og/${hash}.png?i=${i}`;
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
```

Since the hash binds the inputs, the same inputs always produce the
same URL — perfect cache key. CDN serves it from edge for a year;
when content changes, the hash changes, and the new URL bypasses the
old cache automatically.

### 5. Per-route assembly

```ts
// src/routes/blog/[slug]/+page.server.ts
import { Meta } from '$lib/social/types';
import { ogImageUrl } from '$lib/social/og-url';

export async function load({ params, url }) {
  const post = await getPost(params.slug);

  const imageUrl = await ogImageUrl({
    v: 1,
    template: 'article',
    title: post.title,
    subtitle: post.excerpt.slice(0, 120),
    authorName: post.author.name,
    authorAvatarUrl: post.author.avatarUrl,
    badgeText: post.category.name,
    locale: 'en_US',
    theme: 'light',
  });

  const meta = Meta.parse({
    title: post.title,
    description: post.excerpt,
    canonical: `${url.origin}/blog/${post.slug}`,
    themeColor: '#0a0a0a',
    ogType: 'article',
    locale: 'en_US',
    alternateLocales: post.translations.map(t => t.locale),
    image: { url: imageUrl, alt: post.title, width: 1200, height: 630 },
  });

  return { post, meta };
}
```

### 6. Fallback when image render fails

The dynamic endpoint can fail (font CDN down, satori bug). Keep a
**static fallback** committed under `/static/og-fallback.png` and
serve it from a SvelteKit hook on 5xx:

```ts
// src/hooks.server.ts
export async function handle({ event, resolve }) {
  const response = await resolve(event);
  if (event.url.pathname.startsWith('/og/') && response.status >= 500) {
    return new Response(await readFile('static/og-fallback.png'), {
      status: 200,
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300' },
    });
  }
  return response;
}
```

5-minute TTL on the fallback (not 1-year) so the moment the dynamic
endpoint recovers, scrapers re-fetch.

### 7. Validation in CI

```ts
// scripts/validate-meta.ts
// Run during CI on a sample of routes; fails the build if a meta tag
// is missing or out-of-spec.
import { Meta } from '../src/lib/social/types';
import { chromium } from 'playwright';

const ROUTES = ['/', '/blog/sample-post', '/about', '/pricing'];

for (const path of ROUTES) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`http://localhost:3000${path}`);

  const tags = await page.evaluate(() => {
    const get = (sel: string) => document.querySelector(sel)?.getAttribute('content') ?? null;
    return {
      title: document.title,
      description: get('meta[name="description"]'),
      ogTitle: get('meta[property="og:title"]'),
      ogImage: get('meta[property="og:image"]'),
      twitterCard: get('meta[name="twitter:card"]'),
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null,
    };
  });

  const result = Meta.partial().safeParse({
    title: tags.title,
    description: tags.description,
    canonical: tags.canonical,
  });
  if (!result.success) {
    console.error(`✗ ${path}`, result.error.issues);
    process.exit(1);
  }
  console.log(`✓ ${path}`);
  await browser.close();
}
```

The Facebook Sharing Debugger and X Card Validator are manual
fallbacks for one-off issues; CI catches regressions before deploy.

## Per-locale variants

Each locale gets its own `og:image` with translated title:

```ts
const imageUrl = await ogImageUrl({
  v: 1,
  template: 'article',
  title: post.titleByLocale[locale],
  subtitle: post.excerptByLocale[locale]?.slice(0, 120),
  locale: locale,        // shapes which font + RTL handling kicks in
  theme: 'light',
});
```

For RTL locales (Arabic, Hebrew), the satori template must flip
`flexDirection` and use a font with the right glyph coverage — see
[internationalization-routing.md](internationalization-routing.md).

## Anti-patterns

- **Skipping `escapeHtml` on meta values.** Stored XSS. Title from a
  CMS goes through `e()`; non-negotiable.
- **Dynamic OG image URL with non-deterministic params** (timestamps,
  random session ids). Breaks CDN caching; every share is a fresh
  render hitting your origin.
- **Letting `og:image` URL not match the hash.** Defeats the
  content-addressed contract; clients can rewrite to forge previews
  on your domain. Always verify hash in the endpoint.
- **No image on a public marketing page.** Sharing produces a sad
  default preview; conversion drops.
- **Image on a `noindex` route.** Search engines may show the
  thumbnail anyway; if it's truly private, omit `og:image` too.
- **Title > 60 chars.** Truncated mid-word in social previews.
- **Description < 20 or > 160 chars.** Search snippets break.
- **Embedding raw user content in `og:title` without length
  truncation.** Some platforms render >120-char titles weirdly.
- **Bundling Google Fonts URL in satori call.** Fonts must be byte
  arrays. Bundle the `.ttf` files in `/static/fonts/`.
- **Loading 100KB+ avatar PNGs from arbitrary URLs at render time.**
  Pre-fetch + cache + downscale; satori blocks on slow image fetches.
- **No fallback static image on 5xx.** Twitter caches the 5xx response
  for ~24h; you've poisoned shares for a day.
- **Hot-loading the satori font on every render.** Cache at module
  scope; `arrayBuffer()` once.
- **Cache-Control `no-store` on dynamic OG.** CDN bypass means every
  share fetches origin; satori at scale is expensive.
- **`og:image:width` / `:height` mismatch the actual image dimensions.**
  Some clients reject the image as "broken".
- **Forgetting `twitter:card` meta.** Falls back to `summary` (small
  square) instead of `summary_large_image` (1.91:1 banner).
- **Multiple `og:image` tags on one page.** Some scrapers pick the
  *last*, others the *first*. Pick one canonical image per page.
- **Building a custom headless-Chromium pipeline for OG images.**
  10× the cold-start cost vs `@vercel/og`. Use satori unless you
  need WebGL or fonts that satori cannot render.
- **Showing tenant-branded OG images for first-party marketing
  routes.** Use the brand identity for the company; tenant theming
  applies only to the tenant's own surfaces.
- **No CI validation.** A typo in a meta key (`og:titel`) ships
  silently; weekly social engagement craters and nobody knows why.
- **Using `og:locale` without the alternate-locale list.** Search and
  social platforms cannot offer translations; canonicalization breaks.
- **Caching the OG image in the same bucket as user uploads.** Auth
  blurring; OG must be a public bucket with CDN in front; uploads
  are signed-URL access.
- **`X-Robots-Tag: noindex` missing on the `/api/og/` endpoint.**
  Search engines index the API path itself; `site:example.com og`
  shows millions of garbage URLs.
- **Treating `og:type: profile` like `website`.** Profile cards have
  required `profile:first_name` / `profile:last_name` / `profile:username`
  attributes; without them LinkedIn rejects the preview.
- **Using `og:image:secure_url` with `http://`.** The whole point is
  HTTPS; if you must specify, both `og:image` and the secure URL
  must be `https://`.
- **No alt text on `og:image`.** Accessibility requirement; some
  screen readers on social platforms read it.

## References

- ADRs: [0005](../adr/0005-tailwind-4.md),
  [0017](../adr/0017-paraglide-v2.md),
  [0023](../adr/0023-observability-uuidv7.md)
- Sibling recipes: [image-optimization.md](image-optimization.md),
  [internationalization-routing.md](internationalization-routing.md),
  [trusted-types.md](trusted-types.md),
  [caching.md](caching.md),
  [observability.md](observability.md),
  [rate-limiting.md](rate-limiting.md),
  [pwa.md](pwa.md), [analytics.md](analytics.md)
- External: Open Graph protocol (ogp.me); X (Twitter) Cards docs;
  Facebook Sharing Debugger; LinkedIn Post Inspector;
  `@vercel/og` (satori) docs; Schema.org structured data; RFC 9239
  (`text/javascript` content-type clarification — relevant for OG
  scrapers); WCAG 1.1.1 alt text; Google Search Central meta-tag
  reference
