# `oauth-provider.md` — be-the-OIDC-provider recipe for sveltesentio

When your app becomes an **identity provider** (third parties log
in "with YourApp" to access scoped APIs), you need an
OAuth 2.1 + OpenID Connect 1.0 Authorization Server
— not a client. This is the inverse of
[auth-oidc.md](auth-oidc.md) (which consumes upstream IdPs like
Golusoris) and the inverse of
[sso-saml.md](sso-saml.md) (which consumes customer IdPs via WorkOS).

Per [ADR-0032](../adr/0032-auth-posture.md) and
[ADR-0034](../adr/0034-cookies-auth-boundary.md), the default
recommendation is **Ory Hydra** (standalone OAuth2 + OIDC server,
Apache 2.0, certified by OpenID Foundation) with sveltesentio owning
only the **consent UI** + **login UI**. Do not hand-roll an
Authorization Server — the spec surface (RFC 6749, 6750, 7636 PKCE,
8414 discovery, OIDC Core, OIDC Discovery, JWKS rotation, DPoP) is
large and mistakes are catastrophic.

## Related

- [auth-oidc.md](auth-oidc.md) — inverse: sveltesentio as OIDC
  **client** consuming Golusoris
- [sso-saml.md](sso-saml.md) — consuming customer IdPs via WorkOS
- [cookies-authoritative.md](cookies-authoritative.md) — cookie
  attribute matrix
- [mfa.md](mfa.md) — step-up on sensitive scopes
- [rbac-modeling.md](rbac-modeling.md) — scope → permission mapping
- [rate-limiting.md](rate-limiting.md) — token endpoint protection
- [audit-log.md](audit-log.md) — grant + token issuance events
- [ADR-0032](../adr/0032-auth-posture.md) — auth posture
- [ADR-0034](../adr/0034-cookies-auth-boundary.md) — cookies
- OAuth 2.1 draft: `datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1`
- OIDC Core 1.0: `openid.net/specs/openid-connect-core-1_0.html`

## When to use what — decision tree

```text
Users log into MY app via Google/GitHub       → auth-oidc.md (you are the client)
Enterprise customers bring their own IdP      → sso-saml.md (WorkOS)
Third-party devs build apps against my API    → THIS recipe (you are the AS)
Internal service-to-service auth              → mTLS or service-account JWTs, not OAuth
Personal / programmatic access tokens         → opaque tokens + DB lookup, not OAuth
Machine-to-machine (no user involved)         → OAuth Client Credentials grant only
```

## Install — Ory Hydra as the Authorization Server

```bash
# Hydra runs as a separate service (Docker or Helm). The SvelteKit
# app owns only the Login UI + Consent UI.
docker run -d --name hydra \
  -p 4444:4444 -p 4445:4445 \
  -e DSN=postgres://hydra:pw@db:5432/hydra \
  -e URLS_SELF_ISSUER=https://id.example.com \
  -e URLS_LOGIN=https://app.example.com/oauth/login \
  -e URLS_CONSENT=https://app.example.com/oauth/consent \
  -e URLS_LOGOUT=https://app.example.com/oauth/logout \
  -e SECRETS_SYSTEM=$(openssl rand -hex 32) \
  oryd/hydra:v2.2 serve all
```

```bash
# SvelteKit side — only needs the Admin API SDK
pnpm add @ory/hydra-client zod
```

## Architecture — two sides of the dance

```text
┌─────────────────┐  1. /oauth2/auth (browser)  ┌────────────┐
│  Third-party    │ ─────────────────────────▶ │ Hydra public │
│  client app     │                            │  :4444       │
│  (consumer)     │ ◀─ redirect to /login ──── │              │
└─────────────────┘                            └──────┬───────┘
                                                      │
                                    Admin API :4445   │
                                    (accept login /   │
                                     accept consent)  ▼
                                            ┌─────────────────┐
                                            │  sveltesentio    │
                                            │  app (login UI + │
                                            │  consent UI)     │
                                            └─────────────────┘
```

SvelteKit **never** issues tokens or inspects client credentials
directly. It owns only the two HTML surfaces Hydra redirects to:
`/oauth/login` and `/oauth/consent`. Hydra does all protocol work
(token endpoint, JWKS, introspection, revocation, discovery).

## Shape — bounded Zod contracts

```ts
// packages/oauth/src/schema.ts
import { z } from 'zod';

export const Scope = z.enum([
  'openid',
  'profile',
  'email',
  'offline_access',
  'read:projects',
  'write:projects',
  'read:billing',
]);
export type Scope = z.infer<typeof Scope>;

export const ClientId = z.string().regex(/^[a-zA-Z0-9_-]{8,40}$/);
export type ClientId = z.infer<typeof ClientId>;

export const LoginChallenge = z.string().regex(/^[a-f0-9]{32}$/);
export const ConsentChallenge = z.string().regex(/^[a-f0-9]{32}$/);

export const ConsentDecision = z.object({
  challenge: ConsentChallenge,
  grantedScopes: z.array(Scope).min(1),
  remember: z.boolean().default(false),
  rememberFor: z.number().int().min(0).max(86400 * 30).default(0),
});
export type ConsentDecision = z.infer<typeof ConsentDecision>;

export const LoginDecision = z.object({
  challenge: LoginChallenge,
  subject: z.string().uuid(),
  remember: z.boolean().default(false),
  rememberFor: z.number().int().min(0).max(86400 * 30).default(0),
  acr: z.enum(['0', '1', '2']).default('1'), // Authentication Context Class Reference
});
export type LoginDecision = z.infer<typeof LoginDecision>;

// Per-scope human-readable metadata for the consent screen.
export const SCOPE_META: Record<Scope, { title: string; description: string; sensitivity: 'low' | 'medium' | 'high' }> = {
  openid:            { title: 'Sign in',              description: 'Use your identity to sign in', sensitivity: 'low' },
  profile:           { title: 'Profile',              description: 'Name, avatar, username',        sensitivity: 'low' },
  email:             { title: 'Email address',        description: 'Your primary email',            sensitivity: 'medium' },
  offline_access:    { title: 'Offline access',       description: 'Stay signed in when you are away', sensitivity: 'medium' },
  'read:projects':   { title: 'Read your projects',   description: 'View project metadata',         sensitivity: 'low' },
  'write:projects':  { title: 'Modify your projects', description: 'Create and edit projects',      sensitivity: 'high' },
  'read:billing':    { title: 'View billing info',    description: 'Access billing state',          sensitivity: 'high' },
};
```

## Reference — login challenge handler

```ts
// src/routes/oauth/login/+page.server.ts
import { error, redirect } from '@sveltejs/kit';
import { LoginChallenge } from '@sveltesentio/oauth/schema';
import { hydraAdmin } from '$lib/server/hydra';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
  const parsed = LoginChallenge.safeParse(url.searchParams.get('login_challenge'));
  if (!parsed.success) throw error(400, { type: 'invalid_request' });

  const challenge = parsed.data;
  const { data: req } = await hydraAdmin.getOAuth2LoginRequest({ loginChallenge: challenge });

  // Silent re-auth: user already authenticated + Hydra remembers them.
  if (req.skip) {
    const { data: { redirect_to } } = await hydraAdmin.acceptOAuth2LoginRequest({
      loginChallenge: challenge,
      acceptOAuth2LoginRequest: { subject: req.subject! },
    });
    throw redirect(303, redirect_to);
  }

  return {
    challenge,
    clientName: req.client?.client_name ?? 'Unknown app',
    requestedScopes: (req.requested_scope ?? []) as string[],
  };
};
```

```ts
// src/routes/oauth/login/+page.server.ts (continued — actions)
import type { Actions } from './$types';
import { superValidate, fail } from 'sveltekit-superforms';
import { zod } from 'sveltekit-superforms/adapters';
import { LoginDecision } from '@sveltesentio/oauth/schema';
import { verifyPassword } from '$lib/server/auth';
import { rateLimit } from '$lib/server/rate-limit';
import { auditLog } from '$lib/server/audit';

const LoginForm = LoginDecision.omit({ subject: true, challenge: true }).extend({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});

export const actions: Actions = {
  submit: async ({ request, url, getClientAddress }) => {
    const form = await superValidate(request, zod(LoginForm));
    if (!form.valid) return fail(400, { form });

    const challengeParsed = LoginChallenge.safeParse(url.searchParams.get('login_challenge'));
    if (!challengeParsed.success) throw error(400, { type: 'invalid_request' });

    await rateLimit({
      key: `oauth-login:${getClientAddress()}`,
      limit: 5,
      windowMs: 60_000,
    });

    const user = await verifyPassword(form.data.email, form.data.password);
    if (!user) {
      await auditLog('oauth.login.failed', { email: form.data.email, ip: getClientAddress() });
      return fail(401, { form: { ...form, errors: { _form: 'Invalid credentials' } } });
    }

    await auditLog('oauth.login.succeeded', { userId: user.id, challenge: challengeParsed.data });

    const { data: { redirect_to } } = await hydraAdmin.acceptOAuth2LoginRequest({
      loginChallenge: challengeParsed.data,
      acceptOAuth2LoginRequest: {
        subject: user.id,
        remember: form.data.remember,
        remember_for: form.data.rememberFor,
        acr: form.data.acr,
      },
    });
    throw redirect(303, redirect_to);
  },
};
```

## Reference — consent challenge handler

```ts
// src/routes/oauth/consent/+page.server.ts
import { error, redirect } from '@sveltejs/kit';
import { superValidate, fail } from 'sveltekit-superforms';
import { zod } from 'sveltekit-superforms/adapters';
import { ConsentDecision, ConsentChallenge, SCOPE_META, Scope } from '@sveltesentio/oauth/schema';
import { hydraAdmin } from '$lib/server/hydra';
import { auditLog } from '$lib/server/audit';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ url }) => {
  const parsed = ConsentChallenge.safeParse(url.searchParams.get('consent_challenge'));
  if (!parsed.success) throw error(400, { type: 'invalid_request' });

  const challenge = parsed.data;
  const { data: req } = await hydraAdmin.getOAuth2ConsentRequest({ consentChallenge: challenge });

  const requestedScopes = (req.requested_scope ?? []).filter((s): s is Scope =>
    Scope.safeParse(s).success,
  );

  // Auto-approve "skip" cases: trusted first-party clients with previously remembered consent.
  if (req.skip) {
    const { data: { redirect_to } } = await hydraAdmin.acceptOAuth2ConsentRequest({
      consentChallenge: challenge,
      acceptOAuth2ConsentRequest: {
        grant_scope: requestedScopes,
        grant_access_token_audience: req.requested_access_token_audience,
        session: await buildSession(req.subject!, requestedScopes),
      },
    });
    throw redirect(303, redirect_to);
  }

  return {
    challenge,
    clientName: req.client?.client_name ?? 'Unknown app',
    clientUri: req.client?.client_uri,
    policyUri: req.client?.policy_uri,
    tosUri: req.client?.tos_uri,
    requestedScopes: requestedScopes.map((s) => ({ name: s, ...SCOPE_META[s] })),
    subject: req.subject!,
  };
};

export const actions: Actions = {
  approve: async ({ request, url }) => {
    const form = await superValidate(request, zod(ConsentDecision));
    if (!form.valid) return fail(400, { form });
    const challenge = form.data.challenge;
    const { data: req } = await hydraAdmin.getOAuth2ConsentRequest({ consentChallenge: challenge });

    await auditLog('oauth.consent.granted', {
      userId: req.subject,
      clientId: req.client?.client_id,
      scopes: form.data.grantedScopes,
    });

    const { data: { redirect_to } } = await hydraAdmin.acceptOAuth2ConsentRequest({
      consentChallenge: challenge,
      acceptOAuth2ConsentRequest: {
        grant_scope: form.data.grantedScopes,
        grant_access_token_audience: req.requested_access_token_audience,
        remember: form.data.remember,
        remember_for: form.data.rememberFor,
        session: await buildSession(req.subject!, form.data.grantedScopes),
      },
    });
    throw redirect(303, redirect_to);
  },
  deny: async ({ request }) => {
    const challenge = ConsentChallenge.parse(
      (await request.formData()).get('challenge'),
    );
    const { data: req } = await hydraAdmin.getOAuth2ConsentRequest({ consentChallenge: challenge });

    await auditLog('oauth.consent.denied', {
      userId: req.subject,
      clientId: req.client?.client_id,
    });

    const { data: { redirect_to } } = await hydraAdmin.rejectOAuth2ConsentRequest({
      consentChallenge: challenge,
      rejectOAuth2Request: { error: 'access_denied', error_description: 'User denied consent' },
    });
    throw redirect(303, redirect_to);
  },
};

async function buildSession(subject: string, scopes: Scope[]) {
  const user = await userRepo.findById(subject);
  // id_token claims: only include what scopes permit
  const idToken: Record<string, unknown> = {};
  if (scopes.includes('profile')) {
    idToken.name = user.name;
    idToken.picture = user.avatarUrl;
    idToken.preferred_username = user.username;
  }
  if (scopes.includes('email')) {
    idToken.email = user.email;
    idToken.email_verified = user.emailVerified;
  }
  // access_token claims: scope → permission mapping per rbac-modeling.md
  const accessToken: Record<string, unknown> = {
    permissions: scopesToPermissions(scopes, user.id),
  };
  return { id_token: idToken, access_token: accessToken };
}
```

Claims discipline:

- **`id_token`** claims follow OIDC Core 5.4 — only `profile` scope
  unlocks `name`/`picture`; only `email` scope unlocks `email`. Never
  leak PII outside its scope.
- **`access_token`** claims are audience-specific permission bundles
  (from [rbac-modeling.md](rbac-modeling.md)). Consumers decide
  authorization by reading `permissions`, not by re-reading scopes.
- **No tokens minted here.** Hydra signs the JWT using its rotated
  JWKS; SvelteKit only tells Hydra *what to put inside*.

## PKCE enforcement + token endpoint

Hydra's public endpoint `:4444` serves:

```text
/.well-known/openid-configuration    — RFC 8414 discovery (public)
/.well-known/jwks.json               — JWKS public keys (public, cacheable)
/oauth2/auth                         — authorization endpoint (user-facing)
/oauth2/token                        — token endpoint (client-credentialed)
/oauth2/revoke                       — token revocation
/oauth2/introspect                   — RFC 7662 token introspection (admin)
/userinfo                            — OIDC userinfo endpoint
/oauth2/sessions/logout              — RP-initiated logout
```

Client configuration at creation time:

```ts
await hydraAdmin.createOAuth2Client({
  oAuth2Client: {
    client_name: 'Acme Dashboard',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    scope: 'openid profile email read:projects',
    redirect_uris: ['https://acme.example.com/callback'],
    token_endpoint_auth_method: 'client_secret_basic',
    // PKCE enforcement: required for public clients, forbidden to disable
    require_pkce: true,              // S256 only; plain not accepted
    // RFC 8705 mTLS or DPoP for high-value scopes (optional)
  },
});
```

Per OAuth 2.1: **PKCE S256 is required for all clients** (public +
confidential). `plain` challenge method is forbidden.
`implicit` and `password` grants are **not** configured — the only
allowed grants are `authorization_code` (+ optional `refresh_token`)
and `client_credentials` (M2M only).

## JWKS rotation

```bash
# Ory Hydra auto-rotates via scheduled job (recommended)
# Or trigger manually via the admin API:
curl -X PUT http://hydra-admin:4445/admin/keys/hydra.openid.id-token \
  -H 'content-type: application/json' \
  -d '{"alg":"RS256","kid":"'"$(uuidgen)"'","use":"sig"}'
```

Rotation schedule: **every 90 days** minimum, with **48-hour overlap**
so active tokens signed by the old key remain verifiable until
expiry. Clients must honor `Cache-Control: max-age` on
`/.well-known/jwks.json` (Hydra sets 3600s default); short TTLs
prevent rotation-induced failures.

## Security hardening — mandatory headers on consent + login

```ts
// hooks.server.ts
import { sequence } from '@sveltejs/kit/hooks';

const oauthHeaders = async ({ event, resolve }) => {
  const r = await resolve(event);
  if (event.url.pathname.startsWith('/oauth/')) {
    r.headers.set('Cache-Control', 'no-store');
    r.headers.set('Pragma', 'no-cache');
    r.headers.set('X-Frame-Options', 'DENY');  // clickjacking: never framed
    r.headers.set('Content-Security-Policy',
      "default-src 'self'; frame-ancestors 'none'; form-action 'self';");
  }
  return r;
};
```

Consent screens **must never be framable** — RFC 6819 §4.4.1.9
specifies anti-clickjacking as a critical OAuth threat. `X-Frame-Options:
DENY` + CSP `frame-ancestors 'none'` is defense-in-depth.

## Anti-patterns (25)

1. **Hand-rolling the token endpoint** — JWT signing, nonce
   handling, PKCE validation, state parameter flows: five footguns
   per hour of writing. Use Hydra or similar.
2. **`implicit` grant type** — removed from OAuth 2.1; tokens in the
   URL fragment leak via Referer, browser history, server logs. Use
   `authorization_code` + PKCE exclusively.
3. **`password` grant (Resource Owner Password Credentials)** —
   removed; bypasses consent, trains users to hand passwords to
   third-party apps. Forbidden.
4. **PKCE `plain` method** — attacker can observe the code verifier
   during redirect and replay. S256 only.
5. **Missing PKCE for public clients** — mobile / SPA clients
   without PKCE are vulnerable to authorization code interception
   during the redirect. OAuth 2.1 mandates PKCE for all clients.
6. **No `state` parameter enforcement** — CSRF on authorization
   endpoint; attacker can complete an OAuth flow into the victim's
   account. Hydra requires state by default — never disable.
7. **`X-Frame-Options` missing on consent page** — attacker frames
   the consent page transparently, user clicks "approve" on what
   they think is a different button → third-party app gets scopes.
8. **Consent screen that doesn't show requested scopes clearly** —
   users rubber-stamp; they later find out the app has
   `write:projects`. Must show each scope with human-readable name +
   sensitivity class.
9. **`remember_for: 0` with no explicit expiry UX** — implicit
   remember-forever if Hydra default is infinite. Always set an
   explicit bound.
10. **Leaking email in `id_token` without `email` scope** — breaks
    OIDC claims discipline and leaks PII. Always filter claims by
    granted scopes.
11. **Not rotating JWKS** — a leaked signing key allows permanent
    token forgery. Rotate every 90 days.
12. **No key overlap during rotation** — tokens signed by the old
    key fail verification instantly; every consumer has downtime.
    Always keep old keys in JWKS until their issued tokens expire.
13. **Access tokens without `exp` (expiration)** — permanent tokens.
    Use 1h access + refresh token with absolute expiry.
14. **Refresh tokens without rotation** — leaked refresh token =
    permanent access. Rotate on every use, invalidate family on
    detected reuse (RFC 6749 §10.4).
15. **No audit log on consent grants + token issuance** — compliance
    + incident response need an event trail. Every decision logs to
    [audit-log.md](audit-log.md).
16. **Broad default scopes** — registering clients with
    `scope: 'read write admin'` encourages over-request. Use
    incremental authorization (ask for scopes when actually needed).
17. **Unrestricted `redirect_uri`** — wildcards or open-redirect
    patterns allow attacker-controlled callback URLs. Exact match
    only; enforce HTTPS for production (per OAuth 2.1 BCP).
18. **No rate limit on token endpoint** — credential stuffing on
    `client_credentials` grant. Redis token bucket per client_id.
19. **Issuing ID tokens to machine-to-machine clients** — ID tokens
    are for end-user authentication; M2M uses `access_token` only.
20. **Storing client secrets in plaintext** — Hydra hashes them by
    default. If customizing, use Argon2id.
21. **Silent authorization without prior consent** — `prompt=none`
    combined with `req.skip` must only succeed when consent was
    previously recorded. Never skip consent unconditionally.
22. **Blocking third-party cookies breaks SSO flows** — use POST
    form redirects or RFC 8628 Device Flow for environments with
    third-party cookies blocked; never depend on 3p cookies.
23. **No logout endpoint / RP-initiated logout** — OIDC front-channel
    + back-channel logout per OIDC Front-Channel 1.0; without it,
    users can't fully sign out across federated apps.
24. **Showing raw error messages from Hydra to end users** — leak
    implementation details. Map to generic user-facing strings + log
    the detail server-side with a correlation ID.
25. **No scope-to-permission mapping documented** — consumers build
    assumptions that diverge from reality. Document via
    [rbac-modeling.md](rbac-modeling.md).

## References

- ADRs: [0032](../adr/0032-auth-posture.md),
  [0034](../adr/0034-cookies-auth-boundary.md),
  [0035](../adr/0035-permissions-model.md),
  [0036](../adr/0036-mfa-posture.md),
  [0023](../adr/0023-compliance-observability.md)
- Sibling recipes:
  [auth-oidc.md](auth-oidc.md),
  [sso-saml.md](sso-saml.md),
  [cookies-authoritative.md](cookies-authoritative.md),
  [mfa.md](mfa.md),
  [rbac-modeling.md](rbac-modeling.md),
  [rate-limiting.md](rate-limiting.md),
  [audit-log.md](audit-log.md)
- Upstream specs:
  OAuth 2.1 `datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1`,
  OIDC Core `openid.net/specs/openid-connect-core-1_0.html`,
  OIDC Discovery `openid.net/specs/openid-connect-discovery-1_0.html`,
  RFC 7636 PKCE `datatracker.ietf.org/doc/html/rfc7636`,
  RFC 8414 AS Metadata `datatracker.ietf.org/doc/html/rfc8414`,
  RFC 6819 OAuth Threat Model `datatracker.ietf.org/doc/html/rfc6819`,
  Ory Hydra `www.ory.sh/hydra`.
