# @sveltesentio/auth — AGENTS.md

> Custom thin OIDC client + passkeys + session cookies + permission runes + MFA UI. No third-party auth framework. Phase 7 per `.workingdir/PLAN.md`.

## Scope

No third-party auth framework (openid-client, oidc-client-ts, Auth.js). ID token validation = `oauth4webapi` exact pin; never hand-rolled JOSE ([ADR-0057](../../docs/adr/0057-oidc-id-token-validation-oauth4webapi.md)).

### Landed (v0.0.1) — Web Crypto, cross-runtime (Node + Workers)

| Export                                                                                        | Purpose                                                                                                                                | ADR                                                                     |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `generatePkceChallenge()` → `{ verifier, challenge, method: 'S256' }`                         | OIDC PKCE S256 challenge via SubtleCrypto; RFC 7636 appendix-B vector verified                                                         | [ADR-0032](../../docs/adr/0032-custom-oidc-client-against-golusoris.md) |
| `codeChallengeS256(verifier)` / `generateVerifier(byteLength?)`                               | Deterministic challenge + verifier builders for custom flows                                                                           | ADR-0032                                                                |
| `generateState()` / `generateNonce()`                                                         | 32-byte base64url crypto-random values for OIDC state + nonce                                                                          | ADR-0032                                                                |
| `issueCsrfToken(sessionId, secret, { ttlMs? })` / `verifyCsrfToken(token, sessionId, secret)` | Signed HMAC-SHA256 double-submit token bound to session id; nonce + exp serialised into token itself -> stateless verification         | ADR-0034                                                                |
| `timingSafeEqual(a, b)`                                                                       | Constant-time byte comparison (defense-in-depth even though critical compare lives in `verifyCsrfToken`)                               | ADR-0034                                                                |
| `sessionCookieOptions()` / `csrfCookieOptions()` / `loginNonceCookieOptions()`                | SvelteKit-compatible `CookieOptions` with `__Host-*` invariants baked in (HttpOnly, Secure, SameSite=Lax, Path=/)                      | ADR-0034                                                                |
| `SESSION_COOKIE_NAME` / `CSRF_COOKIE_NAME` / `LOGIN_NONCE_COOKIE_NAME`                        | Canonical cookie-name constants (`__Host-session` / `__Host-csrf` / `__Host-login-nonce`)                                              | ADR-0034                                                                |
| `createPermissions(keys)` → `{ has, can, anyOf, allOf, permissions }`                         | Factory returned from `load`; wildcard-aware dot-path matching (`billing.*`, `*`) — underlying primitive `usePermissions()` rune wraps | [ADR-0035](../../docs/adr/0035-load-derived-permissions.md)             |
| `base64UrlEncode` / `base64UrlDecode` / `randomBytes(n)` / `randomBase64Url(n?)`              | Low-level primitives shared by above                                                                                                   | —                                                                       |

### Landed (v0.2.0) — framework-agnostic orchestration over the primitives

| Export                                                                                    | Purpose                                                                                                                                                 | ADR                                                                     |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `buildAuthorizationUrl(init)`                                                             | Assembles OAuth/OIDC authorize URL with PKCE query params; `extraParams` = first-party-IdP adapter point (e.g. `provider`)                              | [ADR-0032](../../docs/adr/0032-custom-oidc-client-against-golusoris.md) |
| `createAuthorizationRequest(init)` → `{ url, state, nonce, codeVerifier, codeChallenge }` | Generates fresh PKCE pair + state + nonce + redirect URL in 1 call                                                                                      | ADR-0032                                                                |
| `exchangeAuthorizationCode(init)` → `TokenResponse`                                       | POSTs PKCE token exchange (injectable `fetch`); `ProblemError` on non-2xx; `id_token` checked by `oauth4webapi` (sig/iss/aud/exp/nonce), fails closed   | ADR-0057                                                                |
| `handleCsrf({ getContext, ... })` → `Handle`                                              | SvelteKit hook enforcing double-submit token on unsafe methods; verifier + context + reject responder all injectable                                    | [ADR-0034](../../docs/adr/0034-httponly-cookie-sessions.md)             |
| `evaluateCsrf(event, deps)` → `CsrfRejectionReason \| undefined`                          | Pure CSRF decision underlying `handleCsrf`; testable without SvelteKit runtime                                                                          | ADR-0034                                                                |
| `handleAuthError(error, codes?)` → typed `AuthErrorState`                                 | Narrows `ProblemError` to `mfa-required` / `mfa-invalid` / `mfa-rate-limited` by `type` URN — never substring match; custom first-party codes supported | [ADR-0036](../../docs/adr/0036-mfa-ui-structured-errors.md)             |
| `registerPasskey(optionsJSON)` / `authenticatePasskey(optionsJSON)`                       | Thin wrappers over `@simplewebauthn/browser` (optional peer, dynamic import); pass ceremony JSON through verbatim                                       | [ADR-0033](../../docs/adr/0033-simplewebauthn-passkeys.md)              |
| `passkeysSupported()`                                                                     | Reports `browserSupportsWebAuthn()`; `false` when optional peer absent                                                                                  | ADR-0033                                                                |

### Landed (v0.6.0) — permission rune + MFA UI

| Export                                                                           | Purpose                                                                                                            | ADR      |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------- |
| `usePermissions()` rune (`./use-permissions`)                                    | Per-route `load`-derived wrapper over `createPermissions()`                                                        | ADR-0035 |
| `<MfaChallenge>` (`./mfa-challenge`) / `<MfaEnroll>` (`./mfa-enroll`) components | First-class MFA/TOTP UI rendering `handleAuthError()` states; `./mfa-view` view-model + `./session` hook back them | ADR-0036 |

## Invariants — security-critical

- **No token in `localStorage` / `sessionStorage`.** Session lives in `HttpOnly` cookie set by Golusoris. Refresh happens via cookie-bearing request; client never sees token. Refresh-token-in-localStorage = canonical antipattern ([revenge row](../../docs/migrations/downstream-antipatterns-v0.1.md)).
- **MFA branches on typed error codes, not substring match.** Parse `ProblemError` ([ADR-0019](../../docs/adr/0019-openapi-fetch-rfc9457.md)); switch on `error.type === 'urn:golusoris:auth:mfa_required'`. Substring-matching = antipattern (revenge).
- **Permissions are per-route, not global.** `+page.server.ts` `load` returns `{ permissions: [...] }`; components read via `usePermissions()` rune. Global `$permissions` rune banned: leaks across tenants.
- **Passkey ceremony JSON is opaque** — do not introspect or modify `PublicKeyCredentialCreationOptionsJSON` / `PublicKeyCredentialRequestOptionsJSON` payload. Pass Golusoris JSON through `@simplewebauthn/browser` verbatim.
- **No browser-side cryptography** beyond what `@simplewebauthn/browser` does. All challenges + verification happen server-side.

## Canonical recipe

```ts
// +page.server.ts
import { redirect } from '@sveltejs/kit';

export const load = async ({ locals }) => {
  if (!locals.session) redirect(302, '/login');
  return { permissions: locals.session.permissions };
};
```

```svelte
<!-- +page.svelte -->
<script lang="ts">
  import { usePermissions } from '@sveltesentio/auth';
  const { can } = usePermissions();
</script>

{#if can('billing.read')}<BillingPanel />{/if}
```

## Sub-exports

| Path                                 | Purpose                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| `@sveltesentio/auth`                 | Everything above                                                                     |
| `@sveltesentio/auth/csrf`            | `issueCsrfToken` / `verifyCsrfToken` / `timingSafeEqual`                             |
| `@sveltesentio/auth/cookies`         | Cookie name constants + options builders                                             |
| `@sveltesentio/auth/pkce`            | PKCE S256 helpers                                                                    |
| `@sveltesentio/auth/random`          | base64url + `randomBytes` + state/nonce generators                                   |
| `@sveltesentio/auth/permissions`     | `createPermissions` factory                                                          |
| `@sveltesentio/auth/oidc`            | `buildAuthorizationUrl` / `createAuthorizationRequest` / `exchangeAuthorizationCode` |
| `@sveltesentio/auth/csrf-hook`       | `handleCsrf` SvelteKit hook + pure `evaluateCsrf`                                    |
| `@sveltesentio/auth/mfa`             | `handleAuthError` typed narrowing + MFA error-code constants                         |
| `@sveltesentio/auth/passkey`         | `registerPasskey` / `authenticatePasskey` / `passkeysSupported`                      |
| `@sveltesentio/auth/session`         | `handleSession` / `resolveSessionLocals` session hook                                |
| `@sveltesentio/auth/mfa-view`        | `deriveMfaChallengeView` — `handleAuthError` view-model                              |
| `@sveltesentio/auth/use-permissions` | `usePermissions()` rune                                                              |
| `@sveltesentio/auth/mfa-challenge`   | `<MfaChallenge>` component                                                           |
| `@sveltesentio/auth/mfa-enroll`      | `<MfaEnroll>` component                                                              |

## Test policy

- **Never mock session crypto.** Integration tests hit Golusoris fixture instance or sandbox instance — no unit-level crypto fakes diverging from real behaviour.
- Unit tests cover Web Crypto primitives against fixed RFC 7636 vectors (PKCE) + tampered-byte rejection (CSRF) + timing-safe equality.
- Tests cover orchestration: authorize-URL query string, token-exchange `ProblemError` paths with injected `fetch`, `handleCsrf` accept/reject with injected verifier, `handleAuthError` typed narrowing, passkey opaque-JSON passthrough.
- Landed: 64 tests, 9 files.
- Coverage target ≥ 85% (security-critical surface).
- MFA narrowing unit-tested via typed `ProblemError.type`, never substring fallback.
- MFA UI components run under Playwright (`test:e2e`).
- Passkey browser ceremonies run under Playwright with WebAuthn virtual authenticator (follow-through).
- Wrappers unit-tested with mocked `@simplewebauthn/browser`.

## Common tasks

| Task                                 | Command                                      |
| ------------------------------------ | -------------------------------------------- |
| Typecheck                            | `pnpm --filter @sveltesentio/auth typecheck` |
| Unit tests                           | `pnpm --filter @sveltesentio/auth test`      |
| E2E (WebAuthn virtual authenticator) | `pnpm --filter @sveltesentio/auth test:e2e`  |

## Related

- [docs/migrations/downstream-antipatterns-v0.1.md](../../docs/migrations/downstream-antipatterns-v0.1.md) — revenge auth antipatterns (items 1–2) remediated here.
- [docs/principles.md](../../docs/principles.md) §2.2 — OWASP ASVS L2 invariants package enforces.
