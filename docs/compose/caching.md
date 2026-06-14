# Caching — `Cache-Control` matrix + SWR + CDN invariants + cookie pitfalls

Caching is correct-or-catastrophic: a missing `Vary: Cookie` on an
authenticated route serves user A's dashboard to user B; a stale
`max-age=31536000` on a deployed asset pins users to a broken bundle
for a year; an SSR page caches the flash-of-wrong-theme because the
theme cookie wasn't in the cache key. This recipe is the
authoritative cookie-style matrix for `Cache-Control` across SSR
pages, API endpoints, static assets, and image/upload responses —
mirroring the role [cookies-authoritative.md](cookies-authoritative.md)
plays for `Set-Cookie`.

Per [principles.md §2.9](../principles.md) (Core Web Vitals — LCP <
2.5s) and [principles.md §2.2](../principles.md) (OWASP ASVS L2 V6
— sensitive data not in shared caches), the default posture is:
**public caches opt-in**, **private caches explicit**, **stale-while-
revalidate for non-sensitive read paths**, and **immutable with
fingerprinting for versioned assets**. Everything authenticated is
`Cache-Control: private, no-store` until proven otherwise.

## Related

- [cookies-authoritative.md](cookies-authoritative.md) — `Vary:
  Cookie` header pair, CDN-cache hazard on authenticated routes.
- [http-client.md](http-client.md) — client-side cache respects
  `Cache-Control` via `fetch`; `openapi-fetch` doesn't cache by
  default — that's TanStack Query's job.
- [server-state.md](server-state.md) — TanStack Query is the
  client-side cache for authenticated reads; browser disk cache is
  for public assets.
- [observability.md](observability.md) — cache hit-rate per route
  tracked as bounded OTel counter; revalidation latency as histogram.
- [pwa.md](pwa.md) — Service Worker cache is an additional layer
  with its own eviction; don't mix SW cache-key logic with HTTP
  cache-key logic.
- [theming-flash-free.md](theming-flash-free.md) — theme-cookie-
  dependent SSR must `Vary: Cookie` or live in `private, no-store`.
- [consent-management.md](consent-management.md) — consent cookies
  change page shape; either `Vary: Cookie` or `private`.
- [monorepo-releases.md](monorepo-releases.md) — release hash feeds
  asset fingerprints; invalidation is deploy-scoped.
- [api-versioning.md](api-versioning.md) — versioned API paths
  enable per-version cache keys without collision.
- [principles.md §2.9](../principles.md) — Core Web Vitals hardcaps.
- [principles.md §2.2](../principles.md) — OWASP ASVS L2 V6.

## The cache layers

```text
Browser memory cache          (per-tab, per-origin, evictable in ms)
Browser disk cache            (per-origin, honours Cache-Control)
Service Worker cache          (per-origin, you control eviction — pwa.md)
CDN edge cache                (per-POP, shared — Cloudflare/Fastly/CloudFront)
CDN regional cache            (shared upstream, coarser)
Reverse proxy / load balancer (Varnish, nginx, shared)
Application layer cache       (Redis, in-process — server-state concern)
Origin response               (your SvelteKit handler)
```

**Three layer rules:**

1. **Never bypass the layer above without reason.** A CDN-cached
   response reloaded from origin is slower than a disk-cached one.
   Craft `Cache-Control` so each layer holds what it's best at.
2. **Private caches and shared caches obey different rules.**
   `private` forbids shared caches; `public` allows them. Default to
   `private` for anything with auth.
3. **HTTP cache and SW cache are different caches.** Your
   `Cache-Control` header is interpreted by browser + CDN; your SW
   `caches.match()` is per-rule-code in the SW itself.

## The default matrix

| Response shape | Cache-Control | Vary | Notes |
|---|---|---|---|
| Anonymous SSR page | `public, max-age=0, s-maxage=60, stale-while-revalidate=600` | `Accept-Encoding, Accept-Language` | Short origin cache; SWR masks revalidation latency |
| Authenticated SSR page | `private, no-store` | (n/a) | Never touch shared caches |
| Anonymous JSON API | `public, max-age=30, s-maxage=60, stale-while-revalidate=300` | `Accept, Accept-Encoding` | Tune per endpoint |
| Authenticated JSON API | `private, no-store` | — | Default until reviewed |
| Mutation endpoint (POST/PUT/DELETE) | `no-store` | — | Never cached anywhere |
| Hashed asset (JS/CSS with fingerprint) | `public, max-age=31536000, immutable` | — | 1-year + immutable |
| Unhashed asset (favicon, robots) | `public, max-age=86400, stale-while-revalidate=604800` | — | 1-day + SWR week |
| User-uploaded image (signed URL) | `private, max-age=300, no-store` | — | Private; no CDN revalidation |
| Public product image (non-signed) | `public, max-age=604800, stale-while-revalidate=2592000` | — | 1-week + SWR month |
| Error response 4xx | `no-store` | — | Never cache errors |
| Error response 5xx | `no-store` | — | Never cache errors |
| HTML served under OIDC-redirect flow | `private, no-store` | — | State-cookie-bound |
| Server-Sent Events / streaming | `no-cache, no-transform` | — | Must revalidate; proxy MUST NOT transform |
| OpenAPI schema `/api/v2/openapi.json` | `public, max-age=300, stale-while-revalidate=3600` | — | Stable per deploy |

**Rule-of-thumb mnemonic:**

- **`private, no-store`** — authenticated.
- **`public, max-age=short, s-maxage=longer, stale-while-revalidate=much-longer`** — anonymous, read-heavy.
- **`public, max-age=31536000, immutable`** — hashed asset.
- **`no-store`** — mutation or error.

## SvelteKit helper

```ts
// src/lib/http/cache.ts
import type { RequestEvent } from '@sveltejs/kit';

export type CachePolicy =
  | { kind: 'anonymous-page' }
  | { kind: 'anonymous-api' }
  | { kind: 'authenticated'; varyCookie?: boolean }
  | { kind: 'immutable-asset' }
  | { kind: 'uploaded-image'; private: true }
  | { kind: 'public-image' }
  | { kind: 'mutation' }
  | { kind: 'error' };

export function applyCacheHeaders(
  response: Response,
  policy: CachePolicy,
): Response {
  switch (policy.kind) {
    case 'anonymous-page':
      response.headers.set('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=600');
      response.headers.set('Vary', 'Accept-Encoding, Accept-Language');
      return response;
    case 'anonymous-api':
      response.headers.set('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=300');
      response.headers.set('Vary', 'Accept, Accept-Encoding');
      return response;
    case 'authenticated':
      response.headers.set('Cache-Control', 'private, no-store');
      return response;
    case 'immutable-asset':
      response.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      return response;
    case 'uploaded-image':
      response.headers.set('Cache-Control', 'private, max-age=300, no-store');
      return response;
    case 'public-image':
      response.headers.set('Cache-Control', 'public, max-age=604800, stale-while-revalidate=2592000');
      return response;
    case 'mutation':
    case 'error':
      response.headers.set('Cache-Control', 'no-store');
      return response;
  }
}
```

**Five helper rules:**

1. **Discriminated union over a bag of options.** `applyCacheHeaders(r, { kind: 'anonymous-api' })`
   is reviewable; `applyCacheHeaders(r, { maxAge: 60, sharedMaxAge: 300, ... })` invites drift.
2. **Centralized enum of policies.** Any new policy is a named
   addition to the union — reviewable, greppable, testable.
3. **No implicit default.** Every response path picks a policy; the
   absence of the call is a code smell caught in review.
4. **`Vary` is set alongside `Cache-Control`** when the policy
   requires it. Don't split these across files.
5. **No `Expires` or `Pragma`.** `Cache-Control` is the modern
   contract; the legacy headers are ignored by HTTP/1.1+ caches
   and add noise.

Usage in a route:

```ts
// src/routes/docs/[slug]/+page.server.ts
export async function load({ params, setHeaders }) {
  const doc = await loadDoc(params.slug);
  setHeaders({
    'cache-control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=600',
    'vary': 'Accept-Encoding, Accept-Language',
  });
  return { doc };
}
```

Or via `hooks.server.ts` for blanket policies:

```ts
// src/hooks.server.ts
export async function handle({ event, resolve }) {
  const response = await resolve(event);
  if (event.locals.session) {
    response.headers.set('Cache-Control', 'private, no-store');
  }
  return response;
}
```

## `Vary` — the cache-key composition header

A shared cache keys entries by URL + `Vary` headers. Missing `Vary`
on a response that actually differs per input produces cache
poisoning.

**Seven `Vary` rules:**

1. **`Vary: Cookie` on any cookie-dependent SSR page.** Theme,
   locale, consent-banner-shape — all change HTML; omit and the
   first-user's shape serves to everyone.
2. **`Vary: Authorization` on authenticated API responses** even
   when `private` — belt on the suspenders against
   misconfigured-as-`public` upstreams.
3. **`Vary: Accept` on content-negotiated endpoints** (JSON vs
   XML, or `application/vnd.acme.v2+json` per
   [api-versioning.md](api-versioning.md)).
4. **`Vary: Accept-Language` on locale-negotiated pages** —
   Spanish and English share a URL but differ.
5. **`Vary: Accept-Encoding` always** when the CDN gzip/brotli-
   compresses. Most CDNs handle this for you; be explicit anyway.
6. **`Vary: *` is almost always wrong.** Defeats caching entirely;
   use `no-store` if that's what you mean.
7. **Never `Vary: User-Agent`.** Near-infinite cardinality; kills
   cache hit rate. If you're UA-sniffing, redesign.

## Stale-While-Revalidate — the perceived-latency win

`stale-while-revalidate=N` lets the cache serve stale content for up
to N seconds past `max-age` expiry while fetching a fresh copy in
the background. Users see instant response + eventually-fresh data.

```text
Cache-Control: public, max-age=60, stale-while-revalidate=600
```

**Three SWR rules:**

1. **SWR window must be long enough for a revalidate to complete.**
   If origin latency is 2s p95, SWR < 5s is thrashing.
2. **SWR is not correctness.** It's a latency optimization for
   non-critical data. A stale price on a checkout page is a bug; a
   stale "number of commits today" is fine.
3. **`stale-if-error` complements SWR** for graceful origin-outage
   handling — cache serves stale instead of 5xx on origin failure:

    ```text
    Cache-Control: public, max-age=60, stale-while-revalidate=600, stale-if-error=86400
    ```

   Critical for status pages, landing pages, anywhere the "site is
   down" UX is worse than a mildly-stale response.

## Immutable assets — `?v=hash` and bundler fingerprints

SvelteKit + Vite emit hashed filenames (`app-a1b2c3.js`) by default.
Pair with `Cache-Control: public, max-age=31536000, immutable`:

```ts
// svelte.config.js — defaults already correct, but audit:
kit: {
  output: {
    preloadStrategy: 'modulepreload',
  },
  // CDN maps: /_app/immutable/* → 1-year, immutable, public
}
```

**Four immutability rules:**

1. **`immutable` directive is strict** — browsers skip revalidation
   entirely. A mistake is a year-long cache poison. Only for content
   whose URL changes on any change (fingerprint).
2. **Never apply `immutable` to `/index.html`, `/`, or any HTML
   entry point.** Those change per deploy with stable URLs.
3. **Deploys must match fingerprint atomicity.** Old HTML referencing
   new hashed asset names is a 404 storm. Use atomic deploys
   (symlink-swap, blue/green) and keep N-1 assets for at least the
   `max-age` of the previous HTML.
4. **User-uploaded "immutable" assets (S3-signed-URLs per
   [uploads.md](uploads.md))** usually aren't — signed-URL
   expiry undercuts long caching. Use `private, max-age=300`.

## The three authenticated-route traps

### Trap 1 — forgot `Vary: Cookie`, got user-mixing

A shared cache keys on URL + Vary headers. If you set
`Cache-Control: public, max-age=60` on an authenticated page and
forget `Vary: Cookie`, user A's response is served to user B for up
to 60 seconds. Fix: **never `public` + auth**. If the page is
auth-dependent at all, it's `private, no-store`.

### Trap 2 — `private, max-age=N` but the cookie changed mid-window

A private cache (browser) will still serve the cached page even
after logout if the logout didn't revoke the cookie on the server. Fix:
logout must set an expired session cookie *and* the next page post-logout
must be `private, no-store` so the browser re-fetches it.

### Trap 3 — Set-Cookie + Cache-Control: public

Per RFC 7234 § 3, a response with `Set-Cookie` cannot be stored by
shared caches unless `Cache-Control` explicitly allows it. But
browsers and CDNs vary. Fix: **never `Set-Cookie` on cacheable
responses**. If you need to set a cookie, make the response `private,
no-store`.

## Cache-purge / invalidation

Short TTLs are a form of invalidation but sometimes you need
immediate: "we just fixed a bug, purge `/pricing`".

**CDN-specific purge APIs:**

- Cloudflare: `POST /zones/:id/purge_cache` — batch up to 30 URLs.
- Fastly: `PURGE` HTTP method on the URL, or `/service/:id/purge_all`.
- CloudFront: invalidation API with path wildcards.

**Three purge rules:**

1. **Purge via cache-key, not URL alone.** `/pricing` with `Vary:
   Accept-Language` has multiple entries; purge must cover them all.
   Most CDN APIs handle this; verify.
2. **Purge is eventually-consistent.** Cloudflare: < 30s typical;
   Fastly: < 200ms; CloudFront: minutes. Factor this into post-
   deploy smoke tests.
3. **Wildcard purges are blunt** — prefer tagged purges
   (`Cache-Tag: products-listing`) for surgical invalidation on
   Fastly/Cloudflare Enterprise.

## CDN cache keys and the query-string trap

By default, most CDNs include the entire query string in the cache
key. Marketing tracking parameters (`?utm_source=…`) would mean every
UTM variant gets its own cache miss.

**Three query-string rules:**

1. **Strip tracking parameters from the cache key** —
   `utm_source`, `utm_medium`, `utm_campaign`, `fbclid`, `gclid`,
   etc. Most CDNs have a built-in "ignore tracking params" setting.
2. **Keep semantic parameters in the key** — `?page=2`, `?sort=date`
   materially change the response.
3. **Normalize parameter order when possible.** `?a=1&b=2` and
   `?b=2&a=1` are the same resource; some CDNs normalize, many don't.

## Service-Worker cache — a different layer

Service-Worker caches per [pwa.md](pwa.md) obey SW-code rules, not
HTTP `Cache-Control`. An SW can cache a `no-store` response if you
tell it to — which is usually wrong but sometimes right (offline
queue).

**Four SW-cache rules:**

1. **Don't cache authenticated API responses in SW** unless you
   rotate the cache key on logout.
2. **Cache `immutable` assets aggressively** — the SW precache
   step per [pwa.md](pwa.md) default.
3. **Short-TTL `stale-while-revalidate` pattern in SW** for API
   reads the PWA needs offline-available.
4. **Purge SW cache on deploy** — Workbox's cache-versioning
   strategy; otherwise users are pinned to stale API shapes across
   schema changes.

## Observability

```ts
span.setAttributes({
  'cache.policy': policy.kind,              // bounded enum
  'cache.hit': hit,                         // boolean
  'cache.age_seconds': ageSeconds,          // only if hit
});

metrics.cacheHitRate.add(1, {
  policy: policy.kind,
  route: normalizedRoute,                   // /api/orders/:id (no raw IDs)
});
```

**Three observability rules:**

1. **`cache.policy` bounded enum** matches the helper union.
2. **`cache.route` normalized** (IDs stripped) per
   [observability.md](observability.md).
3. **Hit-rate per policy** is the tuning signal — a low hit rate on
   `anonymous-api` says `max-age` is too short or `Vary` is too wide.

## Testing

Unit-test the helper:

```ts
// packages/http/test/cache.test.ts
describe('applyCacheHeaders', () => {
  test('anonymous-page sets public + SWR + Vary', () => {
    const r = applyCacheHeaders(new Response('x'), { kind: 'anonymous-page' });
    expect(r.headers.get('Cache-Control')).toBe('public, max-age=0, s-maxage=60, stale-while-revalidate=600');
    expect(r.headers.get('Vary')).toBe('Accept-Encoding, Accept-Language');
  });
  test('authenticated sets private, no-store', () => {
    const r = applyCacheHeaders(new Response('x'), { kind: 'authenticated' });
    expect(r.headers.get('Cache-Control')).toBe('private, no-store');
  });
});
```

Playwright smoke:

1. **Anonymous page served with `public` + SWR** — response headers
   assertion.
2. **Authenticated page served with `private, no-store`** — login +
   assert no shared-cache hints.
3. **Asset served with `immutable`** — load `/_app/immutable/…` and
   assert directive.

## Anti-patterns

- **Don't mix `public` and authentication.** If the response depends
  on a logged-in user, it's `private, no-store`. No exceptions
  without a named risk-owner.
- **Don't omit `Vary` on cookie-dependent responses.** A shared cache
  serves first-user's shape to everyone. If you can't list the `Vary`
  headers, use `no-store`.
- **Don't use `max-age=0` to mean "don't cache".** `max-age=0` allows
  stale serving with revalidation; use `no-store` for "never keep
  this".
- **Don't cache error responses.** `4xx`/`5xx` responses with
  `max-age > 0` pin users to error states long past the underlying
  fix.
- **Don't `Cache-Control: no-cache` thinking it means "don't
  cache".** `no-cache` means "revalidate before serving" — the
  response IS cached, but re-validated every time.
- **Don't set `Set-Cookie` on a cacheable response.** Shared cache
  behavior around Set-Cookie varies; assume the cookie will be served
  to the wrong user.
- **Don't apply `immutable` to HTML or index documents.** Those have
  stable URLs that change content per deploy — `immutable` pins
  users to old deploys for the `max-age`.
- **Don't `Vary: User-Agent` or `Vary: *`.** The first kills hit
  rate; the second disables caching entirely — use `no-store` if
  that's what you mean.
- **Don't mix CDN tiers with conflicting policies.** `s-maxage` is
  the shared-cache directive; `max-age` is browser. A mismatch
  (`max-age=31536000, s-maxage=60`) is fine and common, but
  unintentional mismatches are bugs.
- **Don't purge wildcards without rate-limits.** A bug-driven
  "purge everything" during peak traffic is a thundering-herd on
  origin. Staged purges, or rely on short TTLs.
- **Don't confuse browser memory cache with disk cache.** Memory is
  evicted in ms; disk respects `Cache-Control`. Testing in a hard-
  reloaded tab isn't the same as a return visit.
- **Don't trust third-party CDN "auto-optimize" modes.** Cloudflare
  APO, Fastly Full-Site Delivery, etc., can inject `Cache-Control`
  headers that override yours. Audit with `curl -I` post-deploy.
- **Don't cache signed-URL responses long.** S3 signed URLs expire;
  caching past expiry produces broken images. `private, max-age=300`.
- **Don't cache SSE / streaming responses.** `no-cache, no-transform`
  — intermediate proxies must not buffer or compress.
- **Don't forget `Vary: Accept-Encoding`.** A missing `Vary:
  Accept-Encoding` on a gzip-served response can cause cache to serve
  gzip bytes to a client that didn't accept encoding.
- **Don't rely on cache for correctness.** Cache is latency
  optimization; business logic must work with cache disabled.
- **Don't serve cached responses for mutations.** `POST`/`PUT`/`DELETE`
  responses must be `no-store`; a cached 200 on a `POST` is a
  double-write waiting to happen.

## References

- [principles.md §2.9 — Core Web Vitals + bundle gates](../principles.md)
- [principles.md §2.2 — OWASP ASVS L2 V6 (sensitive data)](../principles.md)
- Sibling recipes: [cookies-authoritative.md](cookies-authoritative.md),
  [http-client.md](http-client.md),
  [server-state.md](server-state.md),
  [observability.md](observability.md),
  [pwa.md](pwa.md),
  [theming-flash-free.md](theming-flash-free.md),
  [consent-management.md](consent-management.md),
  [api-versioning.md](api-versioning.md),
  [monorepo-releases.md](monorepo-releases.md),
  [uploads.md](uploads.md).
- Upstream specs:
  - RFC 9111 — HTTP Caching: <https://www.rfc-editor.org/rfc/rfc9111>
  - RFC 5861 — stale-while-revalidate / stale-if-error: <https://www.rfc-editor.org/rfc/rfc5861>
  - RFC 7234 — HTTP/1.1 Caching (legacy, superseded): <https://www.rfc-editor.org/rfc/rfc7234>
  - MDN `Cache-Control`: <https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control>
  - Cloudflare cache behavior: <https://developers.cloudflare.com/cache/concepts/default-cache-behavior/>
  - Fastly cache primer: <https://www.fastly.com/documentation/guides/concepts/caching/>
