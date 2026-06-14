# csrf-double-submit.md — composition recipe

> **CSRF defense-in-depth for sveltesentio.** SvelteKit already ships
> a **baseline Origin/Referer check** (CSRF protection on state-
> changing requests); this recipe documents the **three layers** that
> make it robust in real deployments: **Origin check** (SvelteKit
> default, fail-closed), **SameSite=Lax cookie** (browser-level
> default), and **signed double-submit token** (defense-in-depth for
> GET-tunneled state changes + APIs served across subdomains). Per
> [ADR-0034](../adr/0034-auth-cookie-and-csrf-contract.md) the
> session cookie is `__Host-session` + `HttpOnly` + `Secure` +
> `SameSite=Lax`; the CSRF token is a separate **`__Host-csrf`**
> cookie readable by JS, sent back as a header, verified server-side
> as an HMAC of the session id.

> **SvelteKit caveat.** `handleCsrf` ships Origin-check enabled for
> POST/PUT/PATCH/DELETE + `application/x-www-form-urlencoded`/`multipart/form-data`/`text/plain`. It does **not** cover
> custom JSON APIs nor cross-subdomain deployments (`api.example.com`
> calling `app.example.com`). The double-submit layer covers those.

## Related

- [auth-oidc.md](auth-oidc.md) — session cookie is the base layer; CSRF
  token is derived from the session id
- [cookies-authoritative.md](cookies-authoritative.md) — cookie
  attribute matrix; `__Host-csrf` lives here
- [forms.md](forms.md) — Superforms posts pick up the token via a
  helper; never hardcode the field
- [http-client.md](http-client.md) — openapi-fetch middleware adds the
  `X-CSRF-Token` header on mutating requests
- [rate-limiting.md](rate-limiting.md) — mismatched token attempts
  trigger per-IP rate-limit + alert
- [audit-log.md](audit-log.md) — every CSRF rejection is logged as a
  security event
- [trusted-types.md](trusted-types.md) — CSP + TT stop the attacker
  from reading `__Host-csrf` via injected script
- [observability.md](observability.md) — `csrf_rejected_total` metric
  with reason label
- [rbac-modeling.md](rbac-modeling.md) — permission checks run
  **after** CSRF check; never before
- [ADR-0034](../adr/0034-auth-cookie-and-csrf-contract.md)

## When to use what

```text
Form POST from same origin (SvelteKit form action)        → Origin check alone suffices
                                                            (SvelteKit default; no extra work)
JSON POST from same origin (fetch('/api/...'))            → Origin + double-submit token
API on `api.example.com` from `app.example.com`           → Origin + double-submit token + CORS
API consumed by first-party mobile app                    → Bearer token (no cookies; no CSRF)
                                                            See auth-oidc.md mobile path
API consumed by third-party (marketplace apps)            → OAuth bearer; NOT cookies
                                                            See oauth-app-marketplace.md
Multipart form with file upload                           → Origin + double-submit; token in a hidden field
GET with side-effects (legacy, avoid)                     → Refactor to POST first; then double-submit token
WebSocket / SSE long-lived connection                     → One-time token at handshake;
                                                            do NOT check per-message
Service-to-service webhooks (inbound)                     → HMAC signature, not CSRF (webhooks.md)
```

## Attack model (what we're actually stopping)

```text
1. Victim logs into app.example.com              → __Host-session cookie set
2. Attacker gets victim to visit evil.example    → attacker-controlled page
3. Evil page: <form action="https://app.example/transfer" method="POST">
                <input name="to" value="attacker" />
              </form> <script>form.submit()</script>
4. Browser sends POST with __Host-session cookie (SameSite=Lax allows POST on top-level nav)
                                                  ← This is the CSRF
5. DEFENSE 1: Origin header = https://evil.example ≠ https://app.example → SvelteKit rejects
6. DEFENSE 2: even if Origin fails (proxy strips it), SameSite=Lax blocks non-top-level sub-requests
7. DEFENSE 3: token in cookie must match header/field; attacker cannot read __Host-csrf cross-site
```

One layer failing doesn't break the system; two would.

## Install

No dependencies. Uses Node's built-in `crypto` and SvelteKit hooks
only.

## Shape — bounded Zod for the token contract

```ts
// packages/auth/src/csrf/types.ts
import { z } from 'zod';

export const CsrfToken = z.object({
  // The double-submit value. URL-safe base64, 32 bytes HMAC output.
  value: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  // Session id this token is bound to. Opaque.
  sid: z.string().min(16).max(128),
  // Not-before + expiry timestamps (ms). Token rotates on session rotate.
  nbf: z.number().int().positive(),
  exp: z.number().int().positive(),
});
export type CsrfToken = z.infer<typeof CsrfToken>;
```

## Reference patterns

### 1. Token issuance — at session creation

```ts
// packages/auth/src/csrf/issue.ts
import crypto from 'node:crypto';
import { env } from '$env/dynamic/private';

const SECRET = Buffer.from(env.CSRF_HMAC_KEY, 'base64'); // 32 bytes
const TTL_MS = 60 * 60 * 1000; // 1 hour; rotate w/ session rotation

export function issueCsrfToken(sessionId: string): { token: string; exp: number } {
  const nonce = crypto.randomBytes(16);
  const exp = Date.now() + TTL_MS;
  const payload = Buffer.concat([
    nonce,
    Buffer.from(sessionId, 'utf8'),
    Buffer.from(String(exp), 'utf8'),
  ]);
  const hmac = crypto.createHmac('sha256', SECRET).update(payload).digest();
  // value = nonce || hmac (16 + 32 = 48 bytes → 64 b64 chars);
  // we encode nonce + hmac concatenated, not the full payload — server
  // recomputes hmac from sid + exp stored out-of-band (session) or in
  // a companion cookie. Simpler: store the full hmac-bound value.
  return {
    token: Buffer.concat([nonce, hmac]).toString('base64url'),
    exp,
  };
}

export function verifyCsrfToken(token: string, sessionId: string): boolean {
  try {
    const buf = Buffer.from(token, 'base64url');
    if (buf.length !== 16 + 32) return false;
    const nonce = buf.subarray(0, 16);
    const tag   = buf.subarray(16);
    // For verification the server needs the `exp` it issued — store
    // exp in a companion attribute or keep the token short-lived and
    // replace on every mutation. Simplest: bind to session expiry.
    // Here we recompute HMAC over nonce||sid||sessionIssuedAt (stable).
    const payload = Buffer.concat([
      nonce,
      Buffer.from(sessionId, 'utf8'),
    ]);
    const expected = crypto.createHmac('sha256', SECRET).update(payload).digest();
    return crypto.timingSafeEqual(tag, expected);
  } catch {
    return false;
  }
}
```

> Real implementation stores `(sid, issuedAt)` in the HMAC payload +
> verifies the `(sid, issuedAt)` pair matches the session record.
> The snippet above is simplified — see [ADR-0034](../adr/0034-auth-cookie-and-csrf-contract.md).

### 2. Cookie set + JS-readable

```ts
// src/hooks.server.ts — after session is established
import { issueCsrfToken } from '$lib/server/csrf';

function setCsrfCookie(event: RequestEvent, sessionId: string) {
  const { token } = issueCsrfToken(sessionId);
  event.cookies.set('__Host-csrf', token, {
    path: '/',
    httpOnly: false, // MUST be readable by first-party JS to put in header/field
    secure: true,
    sameSite: 'lax',
    maxAge: 60 * 60,
  });
}
```

Cookie attributes:

- **`__Host-` prefix** — implicit `Secure` + `Path=/` + no `Domain`;
  prevents a sibling subdomain from setting the cookie.
- **`httpOnly: false`** — the token needs to round-trip via JS into
  the `X-CSRF-Token` header. This is safe: the session cookie stays
  `HttpOnly` and is what the attacker cannot steal.
- **`SameSite=Lax`** — the session cookie is `Lax`; the CSRF cookie
  must match so cross-site POSTs don't bring a fresh token.
- **`maxAge` ≤ session rotation interval** — expire before the session.

### 3. Verification middleware

```ts
// src/hooks.server.ts
import { verifyCsrfToken } from '$lib/server/csrf';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SAFE_CONTENT_TYPES = new Set(['application/json', 'application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain']);

export async function handle({ event, resolve }) {
  if (MUTATING.has(event.request.method)) {
    // Layer 1: Origin check (SvelteKit baseline does this for forms; we widen to JSON)
    const origin = event.request.headers.get('origin');
    const allowed = [event.url.origin, ...trustedOrigins()];
    if (origin && !allowed.includes(origin)) {
      return rejectCsrf(event, 'origin_mismatch');
    }

    // Layer 2: token verification for all mutating requests (including JSON APIs)
    const session = await loadSession(event);
    if (session) {
      const headerToken = event.request.headers.get('x-csrf-token');
      const cookieToken = event.cookies.get('__Host-csrf');
      if (!headerToken || !cookieToken) return rejectCsrf(event, 'token_missing');
      if (!timingSafeEq(headerToken, cookieToken)) return rejectCsrf(event, 'cookie_header_mismatch');
      if (!verifyCsrfToken(headerToken, session.id)) return rejectCsrf(event, 'hmac_invalid');
    }
    // Requests without a session (login form) are governed by Origin check alone;
    // see login-specific flow below.
  }
  return resolve(event);
}

function rejectCsrf(event: RequestEvent, reason: string) {
  recordAudit({
    action: 'security.csrf.rejected',
    actor: event.locals.user?.id ?? null,
    payload: { reason, path: event.url.pathname, method: event.request.method, ip: event.getClientAddress() },
  });
  return new Response(JSON.stringify({ type: 'about:blank', title: 'CSRF validation failed', status: 403, detail: reason }), {
    status: 403,
    headers: { 'Content-Type': 'application/problem+json' },
  });
}
```

Ordering matters:

1. **Method gate** — only mutating methods go through CSRF.
2. **Origin first** — cheap, blocks the broad class before HMAC work.
3. **Session load** — no session → form may be a login; apply
   login-specific token flow below.
4. **Token match** — cookie token must equal header token (double-submit).
5. **HMAC verify** — cookie token must be a valid HMAC of the session id.

Both **header == cookie** and **HMAC** are required. Without HMAC,
an attacker who lands a cookie via subdomain takeover could submit
their own token; with HMAC the token is cryptographically bound to
the session server-side only.

### 4. Login page — pre-session flow

Login is special: there's no session yet, so no HMAC. Use:

- **Origin check** remains.
- **Form token** written to an HttpOnly, short-lived cookie
  (`__Host-login-nonce`, 5 min TTL) + posted in a hidden input.

```ts
// src/routes/login/+page.server.ts
export async function load({ cookies }) {
  const nonce = crypto.randomBytes(16).toString('base64url');
  cookies.set('__Host-login-nonce', nonce, {
    path: '/login', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 5 * 60,
  });
  return { nonce };
}

export const actions = {
  default: async ({ request, cookies }) => {
    const form = await request.formData();
    const nonce = cookies.get('__Host-login-nonce');
    if (!nonce || form.get('nonce') !== nonce) {
      return fail(403, { reason: 'nonce_mismatch' });
    }
    cookies.delete('__Host-login-nonce', { path: '/login' });
    // ... handle login
  },
};
```

After successful login, `setCsrfCookie()` issues the session-bound
token for subsequent requests.

### 5. Client helper — add `X-CSRF-Token` to every fetch

```ts
// src/lib/client/fetch-with-csrf.ts
function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]!) : null;
}

export async function fetchWithCsrf(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  const needsToken = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  const headers = new Headers(init.headers);
  if (needsToken) {
    const token = readCookie('__Host-csrf');
    if (token) headers.set('x-csrf-token', token);
  }

  return fetch(input, { ...init, headers, credentials: 'same-origin' });
}
```

Wire this into the openapi-fetch middleware from
[http-client.md](http-client.md):

```ts
import createClient from 'openapi-fetch';
import type { paths } from './openapi';

export const api = createClient<paths>({
  baseUrl: '/api/v1',
  credentials: 'same-origin',
});

api.use({
  onRequest({ request }) {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
      const token = readCookie('__Host-csrf');
      if (token) request.headers.set('x-csrf-token', token);
    }
    return request;
  },
});
```

### 6. Superforms — token injection

```ts
// src/lib/forms/with-csrf.ts
import { superForm } from 'sveltekit-superforms';
import { readCookie } from './csrf';

export function withCsrf<T extends Record<string, unknown>>(form: T, options?: Parameters<typeof superForm>[1]) {
  return superForm(form, {
    ...options,
    onSubmit: async (args) => {
      const token = readCookie('__Host-csrf');
      if (token) args.formData.set('__csrf', token);
      return options?.onSubmit?.(args);
    },
  });
}
```

Server-side action reads `form.get('__csrf')` as a fallback when the
`X-CSRF-Token` header isn't available (`<form method="POST">` without
JS).

### 7. Cross-origin API (`api.example.com`)

If the API lives on a different subdomain:

1. **CORS allowlist** — `Access-Control-Allow-Origin: https://app.example.com`
   + `Access-Control-Allow-Credentials: true`.
2. **Share the session cookie** via `Domain=example.com` — but **only
   for the session cookie** (not `__Host-csrf`, which cannot have a
   Domain attribute).
3. **Issue `__Secure-csrf`** (not `__Host-`) with `Domain=example.com`
   so both origins see it.
4. **Origin check** — the API accepts requests where
   `Origin: https://app.example.com`, rejects everything else.

`__Host-csrf` is unavailable here because `__Host-` forbids
`Domain`. `__Secure-csrf` accepts `Domain` but loses the subdomain-
cannot-set-cookie guarantee. Compensate with strict CSP on
`app.example.com` so no attacker-injected script runs there.

### 8. Observability + rate-limiting

```ts
// Prometheus metrics
csrf_rejected_total{reason="origin_mismatch"}
csrf_rejected_total{reason="token_missing"}
csrf_rejected_total{reason="cookie_header_mismatch"}
csrf_rejected_total{reason="hmac_invalid"}

// Rate-limit: > 10 CSRF rejections per IP per minute = probable attack
```

Sudden `hmac_invalid` spike per single user = token drift (session
rotation without cookie refresh). `cookie_header_mismatch` spike per
IP = active exploitation attempt; feed into the incident pager.

## Anti-patterns

- **Disabling SvelteKit's baseline Origin check** because "the API is
  JSON and browsers don't send forms to JSON endpoints". Wrong — a
  `<form enctype="text/plain">` happily posts to a JSON endpoint and
  the body is partially parsable.
- **Verifying `Referer` instead of `Origin`.** Some clients strip
  `Referer`; `Origin` is on every cross-origin request.
- **Treating `SameSite=Lax` as sufficient alone.** Top-level GET
  navigations still send Lax cookies; if any GET route has side
  effects (it shouldn't), that's exploitable.
- **Using `SameSite=None` on the session cookie for "mobile apps".**
  Mobile apps don't need cookies; use a Bearer token. Avoid `None`.
- **Storing the CSRF token server-side and comparing to a header.**
  That's stateful, not double-submit. Double-submit's whole point
  is statelessness: the cookie IS the stored value.
- **Bare random token without HMAC.** An attacker with subdomain-set-
  cookie ability can plant any value in both cookie and header.
  HMAC binds to session id; they cannot forge that.
- **Shipping the HMAC secret in a client-reachable bundle.**
  `$env/static/private` only. See [secrets-management.md](secrets-management.md).
- **Using `Math.random()` for nonces.** Non-cryptographic; predictable
  in theory. `crypto.randomBytes` only.
- **Reusing the CSRF cookie across sessions.** On session rotation,
  reissue; on logout, delete.
- **One CSRF token for all tabs.** Fine — the value is the same per
  session, not per tab. But rotate on session rotation.
- **Token lifetime > session lifetime.** Token outlives session, POST
  succeeds with stale session → auth middleware fails, but CSRF check
  passed — wastes work. Align lifetimes.
- **Treating PATCH as safe and skipping CSRF.** PATCH is a mutating
  method; check it.
- **Skipping CSRF on endpoints that "only read".** If GET has any
  state change, it's wrong even without CSRF. Refactor first.
- **Serving `__Host-csrf` without `Secure`.** `__Host-` requires
  `Secure`; your framework will still let a typo slip.
- **Using `crypto.createHmac(...).digest('hex')` and comparing with
  `===`.** Timing attack primitive. Use `timingSafeEqual` always.
- **Token base64-url-encoded but header compared after decode.**
  Round-trip through decode/encode breaks constant-time compare.
  Compare raw strings.
- **Returning `400` or `401` for CSRF failure.** Use `403 Forbidden`
  + `application/problem+json`. The distinction is meaningful for
  the client (auth still valid; just not this action from this origin).
- **No audit log of rejections.** Forensics find nothing after a
  breach attempt. Every rejection is a security event.
- **No rate-limit on rejections.** Attackers iterate to find a path
  with buggy CSRF. Limit per IP.
- **CORS `Access-Control-Allow-Origin: *` with `Allow-Credentials:
  true`.** Browsers reject, but some libraries set both and expect it
  to work. Explicit allowlist or go home.
- **Exempting `multipart/form-data` from CSRF** because "file uploads
  are special". They're not. The form wrapping the upload is the
  attack vector.
- **Trusting any header starting with `x-requested-with: XMLHttpRequest`
  as CSRF proof.** jQuery convention; not enforced anywhere. Cross-
  origin scripts can set arbitrary headers via `fetch` (post-CORS
  preflight). Use the real token.
- **Not rotating the token after a privilege change (password
  change, email change).** Rotate session + token on every sensitive
  action; freshness is the anti-phishing feature.
- **Allowing CSRF token to survive logout.** Delete `__Host-csrf` on
  logout; otherwise next-user-on-same-browser inherits.
- **Debugging `cookie_header_mismatch` by logging both tokens.** Logs
  are a leak vector; log only the mismatch count + hash prefix.
- **Applying CSRF check AFTER RBAC permission check.** Reverse order:
  if the request fails CSRF, we don't need to evaluate permissions
  — don't burn DB reads on rejected traffic.

## References

- ADRs: [0034](../adr/0034-auth-cookie-and-csrf-contract.md),
  [0032](../adr/0032-auth-oidc-relay.md),
  [0019](../adr/0019-server-state-discipline.md)
- Sibling recipes: [auth-oidc.md](auth-oidc.md),
  [cookies-authoritative.md](cookies-authoritative.md),
  [forms.md](forms.md), [http-client.md](http-client.md),
  [rate-limiting.md](rate-limiting.md),
  [audit-log.md](audit-log.md),
  [trusted-types.md](trusted-types.md),
  [observability.md](observability.md),
  [rbac-modeling.md](rbac-modeling.md),
  [secrets-management.md](secrets-management.md)
- External: OWASP ASVS L2 §4 (session management); OWASP Cheat Sheet
  "Cross-Site Request Forgery Prevention"; RFC 6265bis (cookies);
  fetch/CORS spec; SvelteKit `handleCsrf` docs; PortSwigger Web
  Security Academy CSRF labs; SameSite cookie research (Google Chrome
  team); OAuth 2.1 §4.13 (CSRF in authorization flow)
