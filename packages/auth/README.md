# @sveltesentio/auth

> SvelteKit auth patterns — session hooks, CSRF protection, role guards

Part of the [sveltesentio](https://github.com/golusoris/sveltesentio) composable SvelteKit framework.

## Status

v0.2.0 — crypto primitives (PKCE, CSRF HMAC, `__Host-*` cookies, permissions) plus
framework-agnostic OIDC orchestration: authorization-URL builder, PKCE code exchange,
a `handleCsrf()` SvelteKit hook, typed MFA error narrowing, and passkey wrappers.
MFA Svelte components and the `usePermissions()` rune remain follow-through.

## Installation

```bash
pnpm add @sveltesentio/auth
```

## Orchestration surface (v0.2.0)

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
