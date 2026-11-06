# @sveltesentio/auth

> SvelteKit auth patterns — session hooks, CSRF protection, role guards

Part of the [sveltesentio](https://github.com/golusoris/sveltesentio) composable SvelteKit framework.

## Status

v0.10.0 — crypto primitives (PKCE, CSRF HMAC, `__Host-*` cookies, permissions) plus
framework-agnostic OIDC orchestration: authorization-URL builder, PKCE code exchange,
a `handleCsrf()` SvelteKit hook, typed MFA error narrowing, and passkey wrappers.
The MFA Svelte components (`<MfaChallenge>` / `<MfaEnroll>`) and the `usePermissions()`
rune have shipped.

## Installation

```bash
pnpm add @sveltesentio/auth
```

## Sub-exports

| Import                               | What                                                                                                                                                                                                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@sveltesentio/auth`                 | The re-export surface for everything below                                                                                                                                                                                                           |
| `@sveltesentio/auth/random`          | `randomBytes`, `randomBase64Url`, `generateState`, `generateNonce`, `base64UrlEncode` / `base64UrlDecode` — the CSPRNG and base64url codec every other primitive here builds on                                                                      |
| `@sveltesentio/auth/pkce`            | `generatePkceChallenge` (64-byte verifier + S256 challenge), `codeChallengeS256`, `generateVerifier`                                                                                                                                                 |
| `@sveltesentio/auth/csrf`            | `issueCsrfToken(sessionId, secret)`, `verifyCsrfToken`, `timingSafeEqual` — tokens are HMAC-bound to the session id, so a token from one session cannot be replayed into another                                                                     |
| `@sveltesentio/auth/csrf-hook`       | `handleCsrf` (SvelteKit hook) and `evaluateCsrf` (the pure decision, returning a failure reason or `undefined`). The submitted header token must both equal the cookie token and verify against the session id and secret; safe methods pass through |
| `@sveltesentio/auth/cookies`         | `sessionCookieOptions`, `csrfCookieOptions`, `loginNonceCookieOptions` and the `__Host-*` cookie names                                                                                                                                               |
| `@sveltesentio/auth/oidc`            | `buildAuthorizationUrl`, `createAuthorizationRequest`, `exchangeAuthorizationCode` — framework-agnostic OIDC orchestration                                                                                                                           |
| `@sveltesentio/auth/passkey`         | `registerPasskey`, `authenticatePasskey`, `passkeysSupported`                                                                                                                                                                                        |
| `@sveltesentio/auth/session`         | `handleSession`, `resolveSessionLocals` — the session hook and its `locals` resolution                                                                                                                                                               |
| `@sveltesentio/auth/permissions`     | `createPermissions` — the framework-free permission checker                                                                                                                                                                                          |
| `@sveltesentio/auth/use-permissions` | `usePermissions` — the rune-backed counterpart, e.g. `{#if perms.can('billing.read')}`                                                                                                                                                               |
| `@sveltesentio/auth/mfa`             | `handleAuthError`, `isMfaRequired`, `MFA_REQUIRED` / `MFA_INVALID` / `MFA_RATE_LIMITED` — typed narrowing of the MFA error codes a provider emits as RFC 9457 `type` URNs (ADR-0036)                                                                 |
| `@sveltesentio/auth/mfa-view`        | `deriveMfaChallengeView`, `isSubmittableCode`, `DEFAULT_MFA_CHALLENGE_COPY` — the view model behind `<MfaChallenge>`, overridable through its `copy` prop                                                                                            |
| `@sveltesentio/auth/mfa-challenge`   | `<MfaChallenge>`                                                                                                                                                                                                                                     |
| `@sveltesentio/auth/mfa-enroll`      | `<MfaEnroll>`                                                                                                                                                                                                                                        |

The framework never branches on the copy strings — the typed `AuthErrorState.kind`
is the source of truth (ADR-0036), so translating or replacing the copy cannot
change a security decision.

## Export reference

### Primitives (v0.0.1) — Web Crypto, cross-runtime (Node + Workers)

| Export                                                                                        | Purpose                                                                                                                                                                                                                                                                                                            | ADR                                                                     |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `generatePkceChallenge()` → `{ verifier, challenge, method: 'S256' }`                         | OIDC PKCE S256 challenge via SubtleCrypto; RFC 7636 appendix-B vector verified                                                                                                                                                                                                                                     | [ADR-0032](../../docs/adr/0032-custom-oidc-client-against-golusoris.md) |
| `codeChallengeS256(verifier)` / `generateVerifier(byteLength?)`                               | Deterministic challenge + verifier builders for custom flows                                                                                                                                                                                                                                                       | ADR-0032                                                                |
| `generateState()` / `generateNonce()`                                                         | 32-byte base64url crypto-random values for OIDC state + nonce                                                                                                                                                                                                                                                      | ADR-0032                                                                |
| `issueCsrfToken(sessionId, secret, { ttlMs? })` / `verifyCsrfToken(token, sessionId, secret)` | Signed HMAC-SHA256 double-submit token bound to session id; nonce + exp serialised into token itself -> stateless verification                                                                                                                                                                                     | ADR-0034                                                                |
| `timingSafeEqual(a, b)`                                                                       | Constant-time byte comparison (defense-in-depth even though critical compare lives in `verifyCsrfToken`)                                                                                                                                                                                                           | ADR-0034                                                                |
| `sessionCookieOptions()` / `csrfCookieOptions()` / `loginNonceCookieOptions()`                | SvelteKit-compatible `CookieOptions`, all `Secure`, `SameSite=Lax`, no `Domain`. Session: `Path=/`, `HttpOnly`. CSRF: `Path=/`, not `HttpOnly`, so browser code reads the token for the header `handleCsrf` checks. Login nonce: `HttpOnly`, `Path=/login`; the `__Host-` prefix requires `Path=/`, fixed in #506. | ADR-0034                                                                |
| `SESSION_COOKIE_NAME` / `CSRF_COOKIE_NAME` / `LOGIN_NONCE_COOKIE_NAME`                        | Canonical cookie-name constants (`__Host-session` / `__Host-csrf` / `__Host-login-nonce`)                                                                                                                                                                                                                          | ADR-0034                                                                |
| `createPermissions(keys)` → `{ has, can, anyOf, allOf, permissions }`                         | Component-side permissions builder; server `load` returns permission keys (serialisable strings), component builds the API; wildcard-aware dot-path matching (`billing.*`, `*`) — underlying primitive `usePermissions()` rune wraps                                                                               | [ADR-0035](../../docs/adr/0035-load-derived-permissions.md)             |
| `base64UrlEncode` / `base64UrlDecode` / `randomBytes(n)` / `randomBase64Url(n?)`              | Low-level primitives shared by above                                                                                                                                                                                                                                                                               | —                                                                       |

### Orchestration (v0.5.0) — framework-agnostic orchestration over primitives

| Export                                                                                    | Purpose                                                                                                                                                              | ADR                                                                     |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `buildAuthorizationUrl(init)`                                                             | Assembles OAuth/OIDC authorize URL with PKCE query params; `extraParams` = first-party-IdP adapter point (e.g. `provider`)                                           | [ADR-0032](../../docs/adr/0032-custom-oidc-client-against-golusoris.md) |
| `createAuthorizationRequest(init)` → `{ url, state, nonce, codeVerifier, codeChallenge }` | Generates fresh PKCE pair + state + nonce + redirect URL in 1 call                                                                                                   | ADR-0032                                                                |
| `exchangeAuthorizationCode(init)` → `TokenResponse`                                       | POSTs PKCE token exchange (injectable `fetch`); `ProblemError` on non-2xx; `id_token` checked by `oauth4webapi` (sig/iss/aud/exp/nonce), fails closed (since v0.9.0) | ADR-0057                                                                |
| `handleCsrf({ getContext, ... })` → `Handle`                                              | SvelteKit hook enforcing double-submit token on unsafe methods; verifier + context + reject responder all injectable                                                 | [ADR-0034](../../docs/adr/0034-httponly-cookie-sessions.md)             |
| `evaluateCsrf(event, deps)` → `CsrfRejectionReason \| undefined`                          | Pure CSRF decision underlying `handleCsrf`; testable without SvelteKit runtime                                                                                       | ADR-0034                                                                |
| `handleAuthError(error, codes?)` → typed `AuthErrorState`                                 | Narrows `ProblemError` to `mfa-required` / `mfa-invalid` / `mfa-rate-limited` by `type` URN — never substring match; custom first-party codes supported              | [ADR-0036](../../docs/adr/0036-mfa-ui-structured-errors.md)             |
| `registerPasskey(optionsJSON)` / `authenticatePasskey(optionsJSON)`                       | Thin wrappers over `@simplewebauthn/browser` (optional peer, dynamic import); pass ceremony JSON through verbatim                                                    | [ADR-0033](../../docs/adr/0033-simplewebauthn-passkeys.md)              |
| `passkeysSupported()`                                                                     | Reports `browserSupportsWebAuthn()`; `false` when optional peer absent                                                                                               | ADR-0033                                                                |

### Runes and MFA UI (v0.5.0)

| Export                                         | Purpose                                                                                                                                                                                                                    | ADR      |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `usePermissions()` rune (`./use-permissions`)  | Per-route `load`-derived wrapper over `createPermissions()`                                                                                                                                                                | ADR-0035 |
| `<MfaChallenge>` (`./mfa-challenge`) component | Accessible TOTP/OTP challenge UI; driven by typed `errorState: AuthErrorState` prop from `handleAuthError()` and `./mfa-view` view model; callback-based (`onSubmit`, `onResend`), no network or session hook dependencies | ADR-0036 |
| `<MfaEnroll>` (`./mfa-enroll`) component       | Accessible TOTP enrolment UI; takes `secret`, optional `qr` / `otpauthUri`, `onVerify` callback, and optional `error?: string` prop for verification failures; pure view, no network or session hook dependencies          | ADR-0036 |

## Orchestration surface (v0.10.0)

```ts
import {
  createAuthorizationRequest,
  exchangeAuthorizationCode,
  handleCsrf,
  handleAuthError,
  registerPasskey,
  authenticatePasskey,
} from '@sveltesentio/auth';

// 1. Build the authorize URL (fresh PKCE + state + nonce).
const req = await createAuthorizationRequest({
  issuer: 'https://app.example/auth/oidc', // first-party IdP adapter point
  clientId: 'web',
  redirectUri: 'https://app.example/callback',
  scope: 'openid profile',
});
// persist req.state / req.nonce / req.codeVerifier in the __Host-login-nonce cookie, then redirect to req.url

// 2. Exchange the code (inject event.fetch in SvelteKit; throws ProblemError on non-2xx).
const tokens = await exchangeAuthorizationCode({
  tokenEndpoint: 'https://app.example/auth/oidc/token',
  clientId: 'web',
  redirectUri: 'https://app.example/callback',
  code,
  codeVerifier: req.codeVerifier,
  // an id_token in the response is verified against these; missing values reject it
  issuer: 'https://app.example/auth/oidc',
  jwksUri: 'https://app.example/auth/oidc/jwks',
  nonce: req.nonce,
  fetch: event.fetch,
});
```

The session lands in an `HttpOnly; Secure; SameSite=Lax` `__Host-session` cookie via
[`sessionCookieOptions()`](./src/cookies.ts) — never `localStorage`. Mutations are guarded
by `handleCsrf()` (double-submit token); MFA UI branches on `handleAuthError()` typed
RFC 9457 codes, never substring matching.

See the [monorepo README](../../README.md) and [`docs/`](../../docs/) for design principles and usage.

## License

EUPL-1.2 © lusoris. Releases up to and including 0.6.0 are MIT.
