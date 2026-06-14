# Cookies — authoritative attribute reference for SvelteKit + Golusoris

[auth-oidc.md](auth-oidc.md) establishes the HttpOnly session-cookie
contract for the OIDC relay against Golusoris; this recipe is the
cross-cutting reference for **every** `Set-Cookie` the framework emits
— session cookies, theme cookies, locale cookies, consent cookies, CSRF
tokens, idempotency hints, sticky-route hints. Cookie attributes are
the single most-misunderstood security surface in modern web apps; this
recipe is the canonical answer for "which attribute combination, why,
and what breaks if I get it wrong".

The 2024 Chrome rollout of CHIPS (`Partitioned`) + the 2025 Safari
ITP 3.0 changes + the death of third-party cookies make the attribute
choices load-bearing in ways they weren't pre-2024. Get them wrong and
your session breaks across the iframe-embed your enterprise customer
demands; get them right and the same cookie just works across iframe,
top-frame, in-app browser, and PWA standalone.

## Related

- [auth-oidc.md](auth-oidc.md) — session cookie shape; this recipe
  documents every attribute that goes on the `Set-Cookie` line.
- [http-client.md](http-client.md) — `credentials: 'include'`
  contract; cookies don't ride along without it.
- [pwa.md](pwa.md) — standalone-PWA cookie scope (no third-party
  context, but iOS Safari still applies ITP).
- [sse.md](sse.md) / [websocket.md](websocket.md) — `withCredentials:
  true` for streaming auth; same cookie attribute rules apply to the
  upgrade request.
- [permissions.md](permissions.md) — `load`-derived permissions read
  session cookie; attribute mistakes manifest as silent permission
  denials post-login.
- [theming-flash-free.md](theming-flash-free.md) — theme cookie
  pattern; non-session cookie attribute reference.
- [observability.md](observability.md) — cookie-related auth failures
  emit structured spans with attribute-mismatch root cause.
- [ADR-0034](../adr/0034-httponly-cookie-sessions.md) — HttpOnly
  session cookie lock.
- [principles.md §2.2](../principles.md) — OWASP ASVS L2 V3 (Session
  Management).

## When this recipe is the source of truth

```text
Setting any cookie from SvelteKit `+server.ts` / `hooks.server.ts`     → consult this matrix
Embedding sveltesentio app in customer iframe                           → CHIPS section is mandatory
Cross-subdomain auth (auth.example.com → app.example.com)               → Domain attribute section
SSO redirect flow with state cookie                                     → SameSite=Lax 5-min state cookie pattern
Theme/locale persistence client-side                                    → non-session attribute pattern
Mobile in-app browser (Instagram/Facebook webview)                      → ITP-resistant pattern (1st-party only)
SSR cache with per-user variant                                         → Vary: Cookie pattern (cache-key risk)
```

## Attribute matrix — the canonical answers

| Attribute | Session cookie | OAuth state | Theme/locale | CSRF token | Idempotency hint | Consent banner |
|---|---|---|---|---|---|---|
| **Name prefix** | `__Host-` | `__Host-` | (none) | `__Host-` | (none) | (none) |
| **HttpOnly** | ✅ mandatory | ✅ mandatory | ❌ JS reads | ✅ if double-submit; ❌ if header-only | ❌ JS reads | ❌ JS reads |
| **Secure** | ✅ mandatory | ✅ mandatory | ✅ mandatory | ✅ mandatory | ✅ mandatory | ✅ mandatory |
| **SameSite** | `Strict` if no SSO; `Lax` if OIDC redirects | `Lax` mandatory | `Lax` | `Strict` | `Lax` | `Lax` |
| **Path** | `/` | `/` | `/` | `/` | `/api/` | `/` |
| **Domain** | omit (host-only) | omit | omit | omit | omit | omit |
| **Max-Age / Expires** | session-id-TTL or omit | 600s | 1y | session | 1h | 1y |
| **Partitioned** | only for iframe-embed flow | only for iframe-embed flow | optional | only for iframe-embed flow | optional | depends on context |
| **Priority** | `High` | `High` | `Low` | `High` | `Medium` | `Low` |

Reading the matrix: pick the column that matches what you're setting,
emit every row that says ✅, omit every row that says ❌, and the
`SameSite`/`Path`/`Max-Age` cell tells you the exact value. Five of
six columns use `__Host-` prefix; the exceptions are JS-readable
cookies (`__Host-` requires `Secure` + `Path=/` + no `Domain`, all
fine; the exception is documentation: many cookie-banner libraries
mangle the prefix on read).

## Shape — session cookie emit

```ts
// src/lib/auth/cookies.ts
import type { Cookies } from '@sveltejs/kit';

export const SESSION_COOKIE = '__Host-session';
export const SESSION_TTL_SECONDS = 60 * 60 * 8;

export function setSessionCookie(cookies: Cookies, sid: string): void {
  cookies.set(SESSION_COOKIE, sid, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: SESSION_TTL_SECONDS,
    priority: 'high',
  });
}

export function clearSessionCookie(cookies: Cookies): void {
  cookies.delete(SESSION_COOKIE, { path: '/' });
}
```

Five emit rules:

- **`__Host-` prefix** — browser-enforced contract: `Secure` + `Path=/`
  + no `Domain`; an attacker on a sibling subdomain cannot overwrite.
- **`sameSite: 'lax'` not `'strict'`** for any session that participates
  in an OIDC redirect — `Strict` blocks the cookie on the cross-site
  navigation back from the IdP; the user lands logged-out.
  Pure-first-party apps with no external sign-in can use `'strict'`.
- **`maxAge` matches server-side session TTL** — letting the cookie
  outlive the server session is a footgun (user sees logged-in UI then
  gets 401 on first action); letting the server outlive the cookie is
  a memory leak.
- **`priority: 'high'`** — Chrome's cookie eviction starts with `low`
  priority cookies when per-host quota fills (~150-180 cookies).
  Session cookies must survive eviction.
- **`cookies.delete(name, { path: '/' })` not `cookies.set(name, '',
  { maxAge: 0 })`** — SvelteKit's `delete` emits the correct
  past-expiry attributes and handles the `__Host-` prefix; manual
  `set('', maxAge: 0)` without matching attributes silently fails
  to delete.

## Shape — OAuth state cookie

```ts
// src/lib/auth/oidc/state.ts
import type { Cookies } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';

const STATE_COOKIE = '__Host-oidc-state';
const STATE_TTL_SECONDS = 600;

export function mintStateCookie(cookies: Cookies, returnTo: string): string {
  const state = randomBytes(32).toString('base64url');
  const payload = JSON.stringify({ state, returnTo, ts: Date.now() });
  cookies.set(STATE_COOKIE, payload, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: STATE_TTL_SECONDS,
    priority: 'high',
  });
  return state;
}

export function consumeStateCookie(cookies: Cookies, returned: string): { returnTo: string } | null {
  const raw = cookies.get(STATE_COOKIE);
  if (!raw) return null;
  cookies.delete(STATE_COOKIE, { path: '/' });
  try {
    const payload = JSON.parse(raw) as { state: string; returnTo: string; ts: number };
    if (payload.state !== returned) return null;
    if (Date.now() - payload.ts > STATE_TTL_SECONDS * 1000) return null;
    return { returnTo: payload.returnTo };
  } catch {
    return null;
  }
}
```

Three state-cookie rules:

- **10-minute TTL** — long enough for slow IdP redirects + user
  hesitation, short enough that an attacker cannot replay.
- **Single-use** — `consumeStateCookie` deletes before validating;
  successful login moves to session cookie; failed validation surfaces
  generic error (no oracle for state-value enumeration).
- **`returnTo` validated server-side as same-origin path** — open-redirect
  classic; never trust the cookie-stored `returnTo` as a URL, parse
  and validate `URL(returnTo, origin).origin === origin`.

## Shape — theme/locale cookie (JS-readable)

```ts
// src/hooks.server.ts
const THEME_COOKIE = 'theme';
const THEME_TTL = 60 * 60 * 24 * 365;

export const handle: Handle = async ({ event, resolve }) => {
  const theme = event.cookies.get(THEME_COOKIE) ?? 'system';
  return resolve(event, {
    transformPageChunk: ({ html }) => html.replace('%sveltekit.theme%', theme),
  });
};
```

```ts
// src/lib/theme/set-theme.ts (client)
export function setTheme(theme: 'light' | 'dark' | 'system'): void {
  document.cookie = `theme=${theme}; Path=/; Max-Age=${365 * 24 * 60 * 60}; SameSite=Lax; Secure`;
  document.documentElement.dataset.theme = theme;
}
```

Three non-session-cookie rules:

- **No `HttpOnly`** — client toggle reads/writes; `HttpOnly` would
  force a server round-trip per toggle.
- **No `__Host-` prefix** — the prefix is a contract for trusted
  origin-bound cookies; theme is non-sensitive and shouldn't claim that
  contract (lib confusion when reading by name).
- **`Secure` still mandatory** — even non-sensitive cookies on HTTPS
  origin must use `Secure` to prevent downgrade-injection.

Per [theming-flash-free.md](theming-flash-free.md): theme cookie pairs
with the SSR `transformPageChunk` to render the correct `data-theme`
on first paint.

## CSRF token — double-submit pattern

```ts
// src/hooks.server.ts (CSRF emit)
import { randomBytes } from 'node:crypto';

const CSRF_COOKIE = '__Host-csrf';

export const handle: Handle = async ({ event, resolve }) => {
  let csrf = event.cookies.get(CSRF_COOKIE);
  if (!csrf) {
    csrf = randomBytes(32).toString('base64url');
    event.cookies.set(CSRF_COOKIE, csrf, {
      path: '/',
      httpOnly: false,
      secure: true,
      sameSite: 'strict',
      priority: 'high',
    });
  }
  event.locals.csrfToken = csrf;
  return resolve(event);
};
```

Three CSRF-token rules:

- **`HttpOnly: false`** — client must read it to echo in `X-CSRF-Token`
  header (the "double-submit" half).
- **`SameSite: 'strict'`** — CSRF token cookie itself rides only on
  first-party requests; combined with same-origin policy on the
  read-and-echo step, this is the contract.
- **Header echo, not body echo** — verify the `X-CSRF-Token` header
  matches the cookie; body-echo defeats the pattern (form auto-fills
  hidden field with cookie via XSS).

SvelteKit's built-in `csrf.checkOrigin` covers the trivial case
(`Origin` header check); the double-submit pattern is needed when you
serve cross-origin POST endpoints that legitimately need credentialed
requests.

## CHIPS — `Partitioned` for embedded contexts

```ts
// when embedded in customer iframe
event.cookies.set('__Host-session', sid, {
  path: '/',
  httpOnly: true,
  secure: true,
  sameSite: 'none',
  maxAge: SESSION_TTL_SECONDS,
  partitioned: true,
});
```

`Partitioned` (CHIPS — Cookies Having Independent Partitioned State)
is the post-3rd-party-cookie way to keep a cookie working in an
iframe-embed. Three rules:

- **`SameSite: 'none'` mandatory with `Partitioned`** — they're a pair;
  without `SameSite=None`, the cookie won't ride on the iframe request
  at all.
- **`Partitioned` cookies are scoped to the top-frame origin** — the
  same `__Host-session` cookie has a different value when the iframe
  is embedded in `customer-a.com` vs `customer-b.com`. This is the
  **point** — it's the privacy-preserving alternative to 3rd-party
  cookies. Your session model must accept this (each top-frame
  origin = a separate session).
- **Browser support: Chrome ≥114, Edge ≥114, Firefox ≥131, Safari
  ≥17** — older browsers ignore `Partitioned` and treat the cookie as
  3rd-party (which Safari ITP and Chrome 3pcd block). For full
  compatibility, emit both a `Partitioned` cookie and a
  `localStorage`-backed token-style fallback for unsupported browsers,
  with a UX banner explaining the limitation.

Don't add `Partitioned` to first-party-only flows — it's a pessimisation
(separate cookie per top-frame origin makes no sense without the
iframe).

## Domain attribute — almost always omit

```ts
// good — host-only, browser scopes to exactly the issuing host
event.cookies.set('__Host-session', sid, { path: '/', /* no domain */ });

// avoid — broadcast to every subdomain
event.cookies.set('session', sid, { path: '/', domain: '.example.com' });
```

Three domain rules:

- **Omit `Domain`** for the default 99% case — the cookie is host-only
  (only the issuing host receives it). Required by `__Host-` prefix.
- **`Domain=.example.com`** broadcasts to every subdomain — only use
  when you have explicit cross-subdomain auth (auth.example.com →
  app.example.com sharing a session); even then, prefer a
  cross-subdomain SSO pattern with `__Host-` cookies on each
  subdomain over a shared parent-domain cookie.
- **Apex vs www** — `Domain=example.com` includes `www.example.com`
  and `app.example.com`; `Domain=www.example.com` includes only
  `www.example.com` and its subdomains. The "leading-dot" syntax is
  ignored by modern browsers — they treat `.example.com` and
  `example.com` identically — but emitting without leading dot is the
  modern convention.

## SSR cache + cookies — `Vary: Cookie` trap

```ts
// src/hooks.server.ts
export const handle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  if (event.cookies.get('__Host-session')) {
    response.headers.set('Cache-Control', 'private, no-store');
  }
  return response;
};
```

Two SSR-cache rules:

- **Authenticated responses use `Cache-Control: private, no-store`** —
  not `Vary: Cookie`. `Vary: Cookie` works in theory but the cache key
  becomes the entire cookie header (every theme/locale/consent change
  invalidates), defeating the cache.
- **Public routes use `Cache-Control: public, max-age=N`** with **no
  cookies set** in the response — set-cookie on a cacheable response
  pollutes downstream caches.

## Domain pinning — `Set-Cookie` vs `Cookie` mismatch debugging

```text
Symptom                                                          → Likely cause
Cookie set on /api but not sent on /                              → Path attribute too narrow (set Path=/)
Cookie set but not sent on next request                           → SameSite=Strict on a redirect-back flow
Cookie set in iframe but not sent on parent                       → Cookies are partitioned by top-frame; not a bug, this is CHIPS
Cookie sent in dev but not prod                                   → Secure attribute on http://localhost:5173 (dev needs http=>secure exemption)
Cookie set but document.cookie returns empty                      → HttpOnly is set; that's the point
Cookie set but Network tab shows it dropped                       → __Host- prefix violated (Domain set, or Path != /, or no Secure)
Cookie sent on top-frame but not on POST                          → SameSite=Lax + cross-origin POST; switch to None+Partitioned or move POST to same-origin
Cookie sent twice with different values                           → Two emitters with different attributes (e.g. one with Domain, one without); browser stores both
```

## Cookie size + count limits

- **Per-cookie size cap: ~4 KB** (RFC 6265 minimum browser support;
  modern browsers go to 8 KB but never count on it).
- **Per-host count cap: ~180 cookies** (Chrome) / ~150 (Firefox);
  `priority` attribute decides eviction order when full.
- **Per-request header cap: ~8 KB total** (server-config
  dependent); enough cookies to hit this break HTTP entirely (502
  from upstream proxy).

If the session payload doesn't fit, store an opaque session ID and
key the actual session into Redis/DB server-side; never put a JWT or
serialised user object into the cookie body.

## Anti-patterns

- **`__Host-` prefix with `Domain` attribute** — browser silently drops
  the `Set-Cookie` header; cookie never lands.
- **`SameSite: 'strict'` on a session participating in OIDC redirect**
  — user lands logged-out post-IdP-callback; switch to `'lax'`.
- **`SameSite: 'none'` without `Secure`** — browser drops the cookie
  (modern spec requirement); `'none'` mandates `Secure`.
- **`SameSite: 'none'` without `Partitioned` in 3rd-party context** —
  Chrome 3pcd + Safari ITP block; cookie never rides on the iframe
  request.
- **`HttpOnly` on a cookie that JS must read** (theme/locale/CSRF
  double-submit) — forces server round-trips per toggle.
- **No `HttpOnly` on session cookie** — XSS instantly compromises
  session.
- **No `Secure` attribute** — anywhere, ever; HTTPS is table stakes
  in 2026.
- **`Set-Cookie` on a cacheable response** — pollutes downstream caches;
  `Cache-Control: private, no-store` on authenticated routes.
- **`Vary: Cookie` for cache key** — theoretical but practically
  defeats caching (every theme/locale change invalidates).
- **JWT or serialised user data in cookie body** — exceeds size limits,
  bypasses revocation, leaks claims via XSS even with `HttpOnly`
  (RAM-side via response body); use opaque session ID + server-side
  store.
- **`Domain=.example.com` without explicit cross-subdomain need** —
  broadcasts cookie to every subdomain (including future-staging,
  marketing-site, etc.); host-only is the safe default.
- **Manual `Set-Cookie` string concatenation** — easy to forget
  `Secure` or escape `;`; use `cookies.set` API.
- **Re-using session cookie name as state cookie** (or any other
  per-flow cookie) — emit different cookies for different lifecycles;
  collisions are ambiguous and hard to debug.
- **`Max-Age` outliving server-side session TTL** — user sees
  logged-in UI then 401s on first action.
- **`Max-Age` without rolling renewal** — long-lived static expiry
  forces re-login at exactly the wrong moment; refresh server-side on
  activity, re-emit cookie with extended `Max-Age`.
- **Setting cookies in `+page.server.ts` `load`** — emits cookie on
  the GET response which may be cached by a CDN that ignores
  `Set-Cookie`; emit in `actions` or `+server.ts` POST/PUT/PATCH only.
- **`document.cookie` for sensitive values** — XSS reads them; use
  `HttpOnly` cookies + server-side state.
- **Skipping `priority: 'high'` on session cookie** — browser may evict
  on quota fill; user randomly logs out.
- **Stripping the `__Host-` prefix in cookie-banner libs** — many
  off-the-shelf banner libs mangle prefixed cookie names; verify before
  adopting.
- **Setting cookies from third-party scripts in `<script>`** — those
  scripts run in your origin; their cookies are your cookies (and your
  XSS surface).
- **`Partitioned` on first-party-only flows** — pessimisation; separate
  cookie per top-frame origin makes no sense without iframe-embed.

## References

- [RFC 6265bis — HTTP State Management Mechanism](https://datatracker.ietf.org/doc/draft-ietf-httpbis-rfc6265bis/)
- [MDN — Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie)
- [MDN — `__Host-` and `__Secure-` prefixes](https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#cookie_prefixes)
- [Cookies Having Independent Partitioned State (CHIPS)](https://developer.chrome.com/docs/privacy-security/chips)
- [Chrome cookie priority + eviction](https://web.dev/articles/cookie-prefixes)
- [SvelteKit `cookies` API](https://kit.svelte.dev/docs/types#public-types-cookies)
- [OWASP ASVS L2 V3 Session Management](https://owasp.org/www-project-application-security-verification-standard/)
- [Safari ITP 3.0 changes](https://webkit.org/tracking-prevention/)
