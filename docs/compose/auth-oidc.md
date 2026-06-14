# OIDC authentication against Golusoris

`@sveltesentio/auth/oidc` is a thin relay to Golusoris's `auth/oidc/*`
endpoints. SvelteKit never runs an OIDC ceremony itself — it redirects
users to Golusoris for start, receives the callback, and asks Golusoris to
mint sessions + refresh tokens. This recipe is the SvelteKit-side wiring.

See [ADR-0032](../adr/0032-custom-oidc-client-against-golusoris.md) for
the decision (why no Auth.js / `openid-client` / `oidc-client-ts`).
Related: [ADR-0034](../adr/0034-httponly-cookie-sessions.md) (HttpOnly
session cookies), [ADR-0035](../adr/0035-load-derived-permissions.md)
(load-derived permissions), [ADR-0033](../adr/0033-simplewebauthn-passkeys.md)
(passkeys).

## Architecture

```text
┌──────────┐        ┌──────────────┐        ┌──────────────┐
│ Browser  │──(1)──▶│  SvelteKit   │──(2)──▶│  Golusoris   │
│          │◀─(6)───│   server     │◀─(5)───│ auth/oidc/*  │
└──────────┘        └──────────────┘        └──────────────┘
                                                   │
                                                   │ (3) OIDC
                                                   ▼
                                            ┌──────────────┐
                                            │   OIDC IdP   │
                                            └──────────────┘

(1) User clicks "Sign in"
(2) SvelteKit proxies /auth/start → Golusoris /auth/oidc/start
(3) Golusoris performs OIDC ceremony with IdP (PKCE + state + nonce)
(4) IdP redirects back to Golusoris /auth/oidc/callback
(5) Golusoris mints session + returns Set-Cookie to SvelteKit
(6) SvelteKit forwards Set-Cookie to browser
```

SvelteKit's job is cookie forwarding + `load`-time session reads. Nothing
cryptographic happens in the SvelteKit process.

## Install

```bash
pnpm add @sveltesentio/auth
```

Peer dependency: `@sveltesentio/core` for `ProblemError` + clock.

## Environment

```ts
// src/env.ts — extend the base env schema
import { z } from 'zod';
import { env } from '$env/dynamic/private';

export const authEnv = z
  .object({
    GOLUSORIS_URL: z.url(), // e.g. https://golusoris.example
    OIDC_PROVIDER_ID: z.string().default('default'),
    SESSION_COOKIE_NAME: z.string().default('sv_session'),
    SESSION_COOKIE_DOMAIN: z.string().optional(),
  })
  .parse(env);
```

## Start login

Client-side trigger:

```svelte
<script lang="ts">
  import { startLogin } from '@sveltesentio/auth/oidc';

  function signIn() {
    startLogin(authEnv.OIDC_PROVIDER_ID, { returnTo: window.location.pathname });
  }
</script>

<button type="button" onclick={signIn}>Sign in</button>
```

`startLogin` navigates to `/auth/start?provider=…&returnTo=…`. The route
below proxies to Golusoris.

Server proxy:

```ts
// src/routes/auth/start/+server.ts
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authEnv } from '$lib/env';

export const GET: RequestHandler = async ({ url }) => {
  const provider = url.searchParams.get('provider') ?? authEnv.OIDC_PROVIDER_ID;
  const returnTo = url.searchParams.get('returnTo') ?? '/';

  const start = new URL(`${authEnv.GOLUSORIS_URL}/auth/oidc/start`);
  start.searchParams.set('provider', provider);
  start.searchParams.set('return_to', returnTo);

  redirect(302, start.toString());
};
```

Golusoris stores `returnTo` + state + PKCE code-verifier server-side and
redirects the user to the IdP.

## Handle callback

Golusoris redirects the user back to SvelteKit with the session cookie
already set (Golusoris-origin). If Golusoris runs on a different origin,
SvelteKit needs to forward the Set-Cookie header on the first hop:

```ts
// src/routes/auth/callback/+server.ts
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authEnv } from '$lib/env';

export const GET: RequestHandler = async ({ url, fetch, cookies }) => {
  // If Golusoris is same-origin, this route is usually unnecessary —
  // the redirect lands directly on the app. Only needed for cross-origin.
  const callback = new URL(`${authEnv.GOLUSORIS_URL}/auth/oidc/callback`);
  for (const [key, value] of url.searchParams) callback.searchParams.set(key, value);

  const resp = await fetch(callback, { credentials: 'include' });
  if (!resp.ok) redirect(302, '/auth/error');

  const setCookie = resp.headers.get('set-cookie');
  if (setCookie) {
    // SvelteKit requires cookies.set() per cookie; parse accordingly.
    // Single-cookie case shown; multi-cookie → use `cookie` library.
    const [pair, ...attrs] = setCookie.split(';').map((s) => s.trim());
    const [name, value] = pair.split('=');
    cookies.set(name, value, {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      domain: authEnv.SESSION_COOKIE_DOMAIN,
      maxAge: 60 * 60 * 12,
    });
  }

  const returnTo = url.searchParams.get('return_to') ?? '/';
  redirect(302, returnTo);
};
```

The session cookie is `HttpOnly; Secure; SameSite=Lax`. See
[ADR-0034](../adr/0034-httponly-cookie-sessions.md).

## Read the session in `load`

Permissions flow through `+layout.server.ts` per
[ADR-0035](../adr/0035-load-derived-permissions.md):

```ts
// src/routes/+layout.server.ts
import { readSession } from '@sveltesentio/auth/oidc';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async (event) => {
  const session = await readSession(event); // null when logged out
  return {
    user: session?.user ?? null,
    permissions: session?.permissions ?? [],
  };
};
```

`readSession(event)` calls Golusoris `GET /auth/session` with the
forwarded cookie, caches the result per-request via `event.locals`, and
returns `null` on 401. No token decoding happens in SvelteKit.

Gate a route with a matcher:

```ts
// src/routes/app/(protected)/+layout.server.ts
import { requireSession } from '@sveltesentio/auth/oidc';

export const load = requireSession({ redirectTo: '/auth/start' });
```

## Refresh on 401

`problemMiddleware` + `refreshMiddleware` are usually composed on the
`openapi-fetch` client:

```ts
import createClient from 'openapi-fetch';
import { problemMiddleware } from '@sveltesentio/core/http';
import { refreshMiddleware } from '@sveltesentio/auth/oidc';
import type { paths } from '$lib/api/schema';

export const api = createClient<paths>({
  baseUrl: authEnv.GOLUSORIS_URL,
  credentials: 'include',
});

api.use(problemMiddleware());
api.use(refreshMiddleware()); // on 401, POST /auth/oidc/refresh + retry once
```

Refresh is attempted exactly once per request. If it fails, the middleware
throws a `ProblemError` with `status: 401` and the UI should trigger
`startLogin()` again.

## Logout

```ts
// any +page.svelte
import { logout } from '@sveltesentio/auth/oidc';

async function signOut() {
  await logout();
  window.location.href = '/';
}
```

`logout()` POSTs to `/auth/oidc/logout` (Golusoris revokes refresh tokens +
clears the session) and clears the local cookie. Redirect after.

## Passkeys

Passkeys are a separate ceremony layered on top of OIDC. See
[passkeys.md](passkeys.md) (pending) and
[ADR-0033](../adr/0033-simplewebauthn-passkeys.md). The OIDC flow above is
orthogonal — passkeys are an authentication *factor*, not a replacement for
the session lifecycle.

## MFA

The server returns a `ProblemError` with `type: "urn:golusoris:mfa-required"`
and a structured `factors` extension when MFA is required. See
[mfa.md](mfa.md) (pending) and
[ADR-0036](../adr/0036-mfa-ui-structured-errors.md).

## Testing

Use a pre-seeded session cookie in Playwright:

```ts
// e2e/setup-auth.ts
import type { Page } from '@playwright/test';

export async function signInAsTestUser(page: Page, userId: string) {
  await page.context().addCookies([
    {
      name: authEnv.SESSION_COOKIE_NAME,
      value: await mintTestSession(userId), // server fixture that calls
                                            // Golusoris's test-mode endpoint
      domain: new URL(authEnv.GOLUSORIS_URL).hostname,
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
}
```

Unit-testing `readSession` + `refreshMiddleware` uses
`@sveltesentio/testing`'s fetch-mock fixtures (planned).

## Anti-patterns

- **Decoding the session JWT in SvelteKit.** Don't. Call `readSession`.
  Token format is Golusoris's concern.
- **Storing tokens in `localStorage`.** Hard rule — session lives in the
  HttpOnly cookie only. This exact antipattern is flagged in
  [docs/migrations/downstream-antipatterns-v0.1.md](../migrations/downstream-antipatterns-v0.1.md).
- **Implementing refresh in a Svelte store.** Refresh happens in the
  HTTP middleware, triggered by 401s on real requests. A store that
  polls refresh is both unnecessary and racy.
- **Rolling a second session concept (e.g. for "guest state").** Use
  anonymous session in Golusoris + the same cookie. One cookie, one
  session.
- **Pulling Auth.js or `openid-client` in app code.** ADR-0032 scope.

## References

- ADR-0032 — custom OIDC client decision.
- ADR-0033 — passkeys (SimpleWebAuthn).
- ADR-0034 — HttpOnly cookie sessions.
- ADR-0035 — load-derived permissions.
- ADR-0036 — MFA UI + structured errors.
- Golusoris `auth/oidc/` README — server-side contract (endpoint shapes).
