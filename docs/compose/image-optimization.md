# Image optimization — Sharp, AVIF/WebP fallback, responsive srcset, CDN

> Build-time and runtime image pipeline for LCP < 2.5 s and CLS < 0.1
> per [ADR-0005](../adr/0005-tailwind4-oklch-tokens.md) performance
> gates + [ADR-0041](../adr/0041-uploads-tus-exifr.md) upload
> validation contract. Default stack: `@sveltejs/enhanced-img`
> (build-time) + Sharp (runtime on-demand) + Cloudflare Images or
> self-hosted Sharp endpoint (CDN delivery).

Image optimization is **layered** — build-time hashing + compile-time
`<picture>` generation cover static marketing assets, while a runtime
Sharp endpoint handles user-uploaded content. Both must emit modern
formats (AVIF > WebP > JPEG fallback chain), responsive srcset tuned
to real breakpoints, and `width`/`height` attributes to reserve layout
space. Upload-side EXIF stripping + dimension validation lives in
[uploads.md](uploads.md); this recipe covers **delivery**.

## Related

- [uploads.md](uploads.md) — EXIF strip + file-type validation on
  inbound
- [uploads-uppy.md](uploads-uppy.md) — Uppy Dashboard option
- [caching.md](caching.md) — immutable asset `Cache-Control`
- [pwa.md](pwa.md) — Service Worker image precache
- [trusted-types.md](trusted-types.md) — CSP `img-src` rules
- [ADR-0041](../adr/0041-uploads-tus-exifr.md) — Upload validation
- [ADR-0005](../adr/0005-tailwind4-oklch-tokens.md) — Perf budgets

## When to use what — decision tree

```text
Static marketing asset in /static or component                   → @sveltejs/enhanced-img (build-time)
User-uploaded avatar / content image                             → Sharp runtime endpoint OR Cloudflare Images
Thumbnails at scale (10k+)                                       → Cloudflare Images / Imgix / Cloudinary
Large gallery with zoom                                          → IIIF tile server (held, app-level)
Animated (GIF replacement)                                       → AV1/WebM video, not animated GIF
Hero banner above the fold                                       → enhanced-img + fetchpriority="high" + preload
Icons / simple vector                                            → inline SVG, not raster
Dark-mode variant                                                → <picture><source media="(prefers-color-scheme: dark)">
```

## Install

```bash
pnpm add -D @sveltejs/enhanced-img sharp
# Optional runtime helpers:
pnpm add @cloudflare/images  # if using Cloudflare Images
```

For SvelteKit:

```ts
// vite.config.ts
import { sveltekit } from '@sveltejs/kit/vite';
import { enhancedImages } from '@sveltejs/enhanced-img';

export default {
  plugins: [enhancedImages(), sveltekit()],
};
```

## Three build rules

1. **Always set `width` and `height`** — otherwise CLS rules you out
   of meeting the Core Web Vitals gate.
2. **Emit AVIF + WebP + original** — AVIF wins size, WebP is safety
   net, original JPEG/PNG covers the last 1 %.
3. **Responsive srcset matches your layout breakpoints, not a ladder**
   — generating `100, 200, 300, ... 2400` ignores that your image
   slot is 320px or 960px.

## Build-time — `@sveltejs/enhanced-img`

```svelte
<script>
  import heroImg from '$lib/assets/hero.jpg?enhanced';
</script>

<enhanced:img
  src={heroImg}
  alt="Dashboard overview — KPI cards above a line chart"
  sizes="(min-width: 1024px) 960px, 100vw"
  loading="eager"
  fetchpriority="high"
  class="rounded-lg"
/>
```

Emits AVIF + WebP + JPEG at multiple widths with content-hashed
filenames and `<picture>` fallback under the hood.

Six build-time rules:

1. **`?enhanced` query is the trigger** — bare `import img from
   '...jpg'` gets you nothing.
2. **`sizes` is mandatory for responsive images** — otherwise the
   browser downloads the largest candidate.
3. **Above-the-fold hero: `loading="eager"` + `fetchpriority="high"`**;
   everything else: `loading="lazy"` (default).
4. **`alt` describes meaning, not appearance** — "KPI cards" not
   "image of a dashboard".
5. **Decorative images: `alt=""`** — empty string, not missing
   attribute (screen-reader will announce the filename if omitted).
6. **Hashed filenames get `Cache-Control: public, max-age=31536000,
   immutable`** — see [caching.md](caching.md).

## Runtime — Sharp endpoint for user uploads

```ts
// src/routes/api/images/[id]/+server.ts
import sharp from 'sharp';
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { fetchOriginalFromStorage } from '$lib/storage';

const ParamsSchema = z.object({
  w: z.coerce.number().int().min(16).max(3840).optional(),
  h: z.coerce.number().int().min(16).max(3840).optional(),
  fmt: z.enum(['avif', 'webp', 'jpeg']).default('webp'),
  fit: z.enum(['cover', 'contain', 'inside']).default('cover'),
  q: z.coerce.number().int().min(40).max(90).default(75),
});

export async function GET({ params, url, setHeaders, request }) {
  const parsed = ParamsSchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) throw error(400, 'invalid params');

  const { w, h, fmt, fit, q } = parsed.data;
  const accept = request.headers.get('accept') ?? '';
  const chosenFmt = negotiate(fmt, accept);

  const original = await fetchOriginalFromStorage(params.id);
  if (!original) throw error(404, 'not found');

  const pipeline = sharp(original).rotate(); // auto-orient from EXIF

  if (w || h) pipeline.resize({ width: w, height: h, fit });

  let body: Buffer;
  if (chosenFmt === 'avif') body = await pipeline.avif({ quality: q }).toBuffer();
  else if (chosenFmt === 'webp') body = await pipeline.webp({ quality: q }).toBuffer();
  else body = await pipeline.jpeg({ quality: q, mozjpeg: true }).toBuffer();

  setHeaders({
    'Content-Type': `image/${chosenFmt}`,
    'Cache-Control': 'public, max-age=604800, immutable',
    'Vary': 'Accept',
    'Content-Security-Policy': "default-src 'none'",
    'Cross-Origin-Resource-Policy': 'same-site',
  });

  return new Response(body);
}

function negotiate(requested: 'avif' | 'webp' | 'jpeg', accept: string): 'avif' | 'webp' | 'jpeg' {
  if (requested === 'avif' && !accept.includes('image/avif')) return 'webp';
  if (requested === 'webp' && !accept.includes('image/webp')) return 'jpeg';
  return requested;
}
```

Seven runtime rules:

1. **Whitelist query parameters with Zod** — free-form allows DoS via
   request-bomb at arbitrary dimensions.
2. **Clamp max dimension** (3840 covers 4K; higher is almost always
   abuse).
3. **`.rotate()` before resize** to honor EXIF orientation — otherwise
   portrait photos render sideways.
4. **Content-negotiate with `Accept` header** — serve AVIF only when
   the browser advertises support.
5. **`Vary: Accept`** on the response so shared caches do not mix
   formats across clients.
6. **`Cache-Control` with `immutable`** because the URL is parameter-
   deterministic (same params → same bytes).
7. **Never stream user-uploaded SVG through this endpoint** — SVG is a
   DOM, not a raster; it belongs in an `<img>` with CSP `default-src
   'none'` sandboxing or sanitized via DOMPurify at render time
   (see [trusted-types.md](trusted-types.md)).

## Responsive srcset — matching layout, not a ladder

```svelte
<script lang="ts">
  type Props = { id: string; alt: string; sizes: string; priority?: boolean };
  const { id, alt, sizes, priority = false }: Props = $props();

  const widths = [320, 480, 640, 960, 1280, 1920];
  const base = `/api/images/${id}`;
  const avif = widths.map((w) => `${base}?w=${w}&fmt=avif ${w}w`).join(', ');
  const webp = widths.map((w) => `${base}?w=${w}&fmt=webp ${w}w`).join(', ');
  const jpeg = widths.map((w) => `${base}?w=${w}&fmt=jpeg ${w}w`).join(', ');
</script>

<picture>
  <source type="image/avif" srcset={avif} {sizes} />
  <source type="image/webp" srcset={webp} {sizes} />
  <img
    src={`${base}?w=960&fmt=jpeg`}
    srcset={jpeg}
    {sizes}
    {alt}
    width="960"
    height="540"
    loading={priority ? 'eager' : 'lazy'}
    fetchpriority={priority ? 'high' : 'auto'}
    decoding={priority ? 'sync' : 'async'}
  />
</picture>
```

Six responsive rules:

1. **Source order matters** — AVIF → WebP → JPEG. Browser picks first
   supported `<source>`.
2. **`sizes` from layout intent** — `(min-width: 1024px) 960px,
   100vw` means "on desktops the image is 960 CSS px; otherwise full
   viewport width".
3. **`width` + `height` attributes on `<img>`** — even with
   `width: 100%` CSS, the attributes let the browser reserve aspect-
   ratio space.
4. **`decoding="async"` for lazy images** releases the main thread
   during large galleries.
5. **Do not generate a width ladder the layout never uses** — a 160px
   variant for an image that is always ≥640px CSS is wasted bandwidth
   at build + storage at the CDN.
6. **DPR is handled by srcset automatically** — do not duplicate with
   `@1x/@2x` filename schemes.

## Blur-up placeholder (LQIP) + dominant color

```ts
// src/lib/images/lqip.ts
import sharp from 'sharp';

export async function generateLqip(buf: Buffer): Promise<{
  blur: string;          // data URL, ~32x32 AVIF <1 kB
  dominant: string;      // oklch color token
  width: number;
  height: number;
}> {
  const meta = await sharp(buf).metadata();
  const blur = await sharp(buf)
    .resize(32, 32, { fit: 'inside' })
    .avif({ quality: 40 })
    .toBuffer();
  const { dominant } = await sharp(buf).stats();
  return {
    blur: `data:image/avif;base64,${blur.toString('base64')}`,
    dominant: rgbToOklch(dominant),
    width: meta.width ?? 0,
    height: meta.height ?? 0,
  };
}
```

Five LQIP rules:

1. **Compute at upload time**, not request time — blur data is <1 kB
   and stored alongside metadata.
2. **Use AVIF at q=40** — smaller than WebP/JPEG at the same blur
   perceptual quality.
3. **Base64-inline the placeholder** in SSR HTML; no extra request.
4. **Dominant color as CSS `background-color`** fills the slot
   pre-decode — cheaper than blur in low-power contexts.
5. **Never use BlurHash** over LQIP — BlurHash needs a JS decoder
   round-trip; base64 AVIF is free in the browser.

## CDN delivery

Matrix:

| Provider | When to pick | Cost shape |
|---|---|---|
| Cloudflare Images | Default when already on CF | $5/100k stored + $1/100k served |
| Imgix | Heavy transform needs, legacy projects | Per-master + per-render |
| Cloudinary | Ops want a dashboard + team workflows | Per-credit, expensive at scale |
| self-host Sharp | Full control, small scale, cost-sensitive | compute + egress |
| `@vercel/image` | Already on Vercel | bundled in platform fee |

Five CDN rules:

1. **Put CDN before Sharp**, not after — cache the rendered variant,
   do not regenerate on every request.
2. **Signed URLs for private content** — unsigned means hotlink abuse.
3. **Origin shielding / tiered cache** for global delivery —
   Cloudflare `Tiered Cache` or Fastly `shielding`.
4. **`Accept` header forwarding at the CDN** — otherwise AVIF
   negotiation collapses to the first client's format.
5. **Purge on original change** via CDN API (cache key = original id
   + params); do not use URL-invalidation if you can avoid it.

## Above-the-fold LCP image

```svelte
<svelte:head>
  <link
    rel="preload"
    as="image"
    href={`/api/images/${heroId}?w=960&fmt=webp`}
    imagesrcset={webpSrcset}
    imagesizes="(min-width: 1024px) 960px, 100vw"
    fetchpriority="high"
  />
</svelte:head>
```

Five LCP rules:

1. **`<link rel="preload" as="image">`** on the hero — starts fetch
   before the parser reaches the `<img>` tag.
2. **`imagesrcset` + `imagesizes` on preload** match the rendered
   `<picture>` — otherwise you preload the wrong candidate.
3. **`fetchpriority="high"`** on both the preload and the `<img>`.
4. **Server-render the `<img>`**, never JS-mount hero images — React/
   Svelte hydration delays LCP by 200–500 ms.
5. **One preloaded hero per page** — preloading three images demotes
   all three.

## Dark-mode variants

```svelte
<picture>
  <source srcset="/img/chart-dark.webp" media="(prefers-color-scheme: dark)" />
  <img src="/img/chart-light.webp" alt="Revenue chart" width="800" height="400" />
</picture>
```

Three dark-mode rules:

1. **`<picture>` + `media` query**, not CSS `background-image` swap
   with visibility toggles — prevents flash on paint.
2. **Design the light and dark images at equal perceptual luminance**
   — users notice jarring brightness shifts.
3. **Do not auto-invert** user-uploaded photos — looks uncanny.

## CSP `img-src`

```
img-src 'self' data: blob: https://cdn.example.com https://imagedelivery.net;
```

Four CSP rules:

1. **`data:` and `blob:`** for LQIP inline + client-generated thumbs.
2. **Enumerate CDNs explicitly** — wildcard `https:` weakens the
   policy.
3. **Separate `img-src` from `default-src`** so a tight default does
   not accidentally block images.
4. **`img-src` `'self'`** is needed even for same-origin `/api/images`
   endpoints.

## Observability

Bounded attributes:

- `image.format` — `avif|webp|jpeg|png`
- `image.transform.width` — bucketed `16-320|321-640|641-1280|1281-1920|1921+`
- `image.cache.tier` — `cdn_hit|cdn_miss|origin_generated`
- `image.source` — `enhanced_img|runtime_sharp|cdn_provider`

Gauges + alerts:

- `image.generation.p95_ms` — Sharp render p95 > 200 ms page on-call
- `image.cdn.hit_rate` — <85 % warns
- `image.bytes_served` per-format — AVIF should dominate >60 %

## Testing

Four lanes:

1. **Unit** — Sharp pipeline returns expected dimensions + format for
   parameter combinations.
2. **Integration** — endpoint rejects out-of-range params with 400;
   honors `Accept`-header negotiation.
3. **Visual regression** — Playwright + Lost-Pixel snapshot per
   breakpoint confirms the correct srcset candidate loads (see
   [playwright-visual.md](playwright-visual.md)).
4. **Performance** — Lighthouse CI asserts LCP image <100 kB over the
   wire, AVIF delivered when supported.

## Anti-patterns

1. **Raw JPEG at 2400 px served to phones** — 5 MB transfers burn
   data plans and LCP.
2. **No `width`/`height`** on `<img>` — CLS catastrophe.
3. **Single format** (only JPEG) — skips 40 %+ savings from AVIF.
4. **Width ladder ignoring layout** — wastes CDN storage + build
   time.
5. **Lazy-loading the hero** — tanks LCP.
6. **`loading="eager"` on everything** — everything is "above the
   fold" is a contradiction.
7. **User-uploaded SVG rendered in `<img>` without CSP** — XSS via
   `<script>` in SVG.
8. **No EXIF strip on upload** — leaks GPS coordinates (see
   [uploads.md](uploads.md)).
9. **CDN without `Vary: Accept`** — mixes AVIF and JPEG variants
   randomly per cache.
10. **Sharp without Zod-validated params** — DoS via `?w=99999` loop.
11. **Regenerating variants per request** — Sharp at origin without a
    CDN in front is a compute bill waiting to happen.
12. **Mixing hashed (`immutable`) and unhashed URLs** with the same
    caching — broken invalidation story.
13. **Animated GIF for UI** — 10x bigger than AV1/WebM video at the
    same visual fidelity.
14. **Forgetting `rotate()`** — portrait photos appear sideways.
15. **Device-pixel-ratio via filename** (`@2x.jpg`) — srcset handles
    this natively.
16. **`<img>` in a flex child without `min-width: 0`** — overflow
    breaks layout; orthogonal to optimization but reports as "image
    too big".
17. **Hotlinking from origin to CDN without signed URLs** — bandwidth
    theft.
18. **Using PNG for photographs** — 3–5x bigger than JPEG/WebP at
    equivalent perceptual quality.
19. **`eager` + `decoding="sync"`** on below-the-fold — main-thread
    jank.
20. **No dominant-color / LQIP placeholder** on dashboard media —
    blank space shifts when the image arrives.

## References

- [ADR-0041 — Uploads (tus + exifr)](../adr/0041-uploads-tus-exifr.md)
- [ADR-0005 — Tailwind 4 / oklch tokens](../adr/0005-tailwind4-oklch-tokens.md)
- [@sveltejs/enhanced-img](https://kit.svelte.dev/docs/images#sveltejs-enhanced-img)
- [Sharp documentation](https://sharp.pixelplumbing.com/)
- [Web.dev — Responsive images](https://web.dev/learn/design/responsive-images/)
- [MDN — `<picture>` element](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/picture)
- [Cloudflare Images](https://developers.cloudflare.com/images/)
- [HTTP Archive — Image Media Types 2024](https://almanac.httparchive.org/en/2024/media)
- [uploads.md](uploads.md) / [caching.md](caching.md) / [trusted-types.md](trusted-types.md) / [playwright-visual.md](playwright-visual.md)
