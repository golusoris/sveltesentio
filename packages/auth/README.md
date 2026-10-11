# @sveltesentio/auth

> SvelteKit auth patterns — session hooks, CSRF protection, role guards

Part of the [sveltesentio](https://github.com/golusoris/sveltesentio) composable SvelteKit framework.

## Status

v0.6.0 — crypto primitives (PKCE, CSRF HMAC, `__Host-*` cookies, permissions) plus
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

## Orchestration surface (v0.6.0)

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
  fetch: event.fetch,
});
```

The session lands in an `HttpOnly; Secure; SameSite=Lax` `__Host-session` cookie via
[`sessionCookieOptions()`](./src/cookies.ts) — never `localStorage`. Mutations are guarded
by `handleCsrf()` (double-submit token); MFA UI branches on `handleAuthError()` typed
RFC 9457 codes, never substring matching.

See the [monorepo README](../../README.md) and [`docs/`](../../docs/) for design principles and usage.

## License

MIT © lusoris
