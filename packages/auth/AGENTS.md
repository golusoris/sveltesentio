# @sveltesentio/auth — AGENTS.md

> Custom thin OIDC client + passkeys + session cookies + permission runes + MFA UI. No third-party auth framework. Phase 7 per [.workingdir/PLAN.md](../../.workingdir/PLAN.md).

## Scope

Mirrors Golusoris's auth endpoints 1:1. **Do not** wrap openid-client, oidc-client-ts, or Auth.js — those duplicate Golusoris's server-side ceremony and introduce dual-source-of-truth bugs.

### Landed (v0.0.1) — Web Crypto, cross-runtime (Node + Workers)

| Export | Purpose | ADR |
|---|---|---|
| `generatePkceChallenge()` → `{ verifier, challenge, method: 'S256' }` | OIDC PKCE S256 challenge via SubtleCrypto; RFC 7636 appendix-B vector verified | [ADR-0032](../../docs/adr/0032-custom-oidc-client-against-golusoris.md) |
| `codeChallengeS256(verifier)` / `generateVerifier(byteLength?)` | Deterministic challenge + verifier builders for custom flows | ADR-0032 |
| `generateState()` / `generateNonce()` | 32-byte base64url crypto-random values for OIDC state + nonce | ADR-0032 |
| `issueCsrfToken(sessionId, secret, { ttlMs? })` / `verifyCsrfToken(token, sessionId, secret)` | Signed HMAC-SHA256 double-submit token bound to session id; nonce + exp serialised into the token itself so verification is stateless | ADR-0034 |
| `timingSafeEqual(a, b)` | Constant-time byte comparison (defense-in-depth even though the critical compare lives in `verifyCsrfToken`) | ADR-0034 |
| `sessionCookieOptions()` / `csrfCookieOptions()` / `loginNonceCookieOptions()` | SvelteKit-compatible `CookieOptions` with `__Host-*` invariants baked in (HttpOnly, Secure, SameSite=Lax, Path=/) | ADR-0034 |
| `SESSION_COOKIE_NAME` / `CSRF_COOKIE_NAME` / `LOGIN_NONCE_COOKIE_NAME` | Canonical cookie-name constants (`__Host-session` / `__Host-csrf` / `__Host-login-nonce`) | ADR-0034 |
| `createPermissions(keys)` → `{ has, can, anyOf, allOf, permissions }` | Factory returned from `load`; wildcard-aware dot-path matching (`billing.*`, `*`) — the underlying primitive the `usePermissions()` rune will wrap | [ADR-0035](../../docs/adr/0035-load-derived-permissions.md) |
| `base64UrlEncode` / `base64UrlDecode` / `randomBytes(n)` / `randomBase64Url(n?)` | Low-level primitives shared by the above | — |

### Follow-through (not in v0.0.1)

| Export | Purpose | ADR |
|---|---|---|
| `passkeys` — `@simplewebauthn/browser@^13` re-export | Optional peer; defer until first downstream adopts | [ADR-0033](../../docs/adr/0033-simplewebauthn-passkeys.md) |
| `usePermissions()` rune | Per-route `load`-derived wrapper over `createPermissions()` | ADR-0035 |
| `<MfaChallenge>` / `<MfaEnroll>` components | First-class MFA/TOTP UI with structured error codes | [ADR-0036](../../docs/adr/0036-mfa-ui-structured-errors.md) |
| `handleCsrf()` SvelteKit hook helper | Method-gate + Origin-check + HMAC-verify compose over `verifyCsrfToken` | ADR-0034 |

## Invariants — security-critical

- **No token in `localStorage` / `sessionStorage`.** Session lives in `HttpOnly` cookie, set by Golusoris. Refresh happens via a cookie-bearing request; the client never sees the token. Refresh-token-in-localStorage is the canonical antipattern ([revenge row](../../docs/migrations/downstream-antipatterns-v0.1.md)).
- **MFA branches on typed error codes, not substring match.** Parse `ProblemError` ([ADR-0019](../../docs/adr/0019-openapi-fetch-rfc9457.md)); switch on `error.type === 'urn:golusoris:auth:mfa_required'`. Substring-matching is an antipattern (revenge).
- **Permissions are per-route, not global.** `+page.server.ts` `load` returns `{ permissions: [...] }`; components read via `usePermissions()` rune. A global `$permissions` rune is banned because it leaks across tenants.
- **Passkey ceremony JSON is opaque** — do not introspect or modify the `PublicKeyCredentialCreationOptionsJSON` / `PublicKeyCredentialRequestOptionsJSON` payload. Pass Golusoris's JSON through `@simplewebauthn/browser` verbatim.
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

| Path | Purpose |
|---|---|
| `@sveltesentio/auth` | Everything above |
| `@sveltesentio/auth/csrf` | `issueCsrfToken` / `verifyCsrfToken` / `timingSafeEqual` |
| `@sveltesentio/auth/cookies` | Cookie name constants + options builders |
| `@sveltesentio/auth/pkce` | PKCE S256 helpers |
| `@sveltesentio/auth/random` | base64url + `randomBytes` + state/nonce generators |
| `@sveltesentio/auth/permissions` | `createPermissions` factory |

## Test policy

- **Never mock session crypto.** Integration tests hit a Golusoris fixture instance or a sandbox instance — no unit-level crypto fakes that diverge from real behaviour.
- Unit tests cover the Web Crypto primitives against fixed RFC 7636 vectors (PKCE) + tampered-byte rejection (CSRF) + timing-safe equality. Landed: 31 tests, 5 files.
- Coverage target ≥ 85% (security-critical surface).
- MFA flow tests exercise typed-error round-trip, not substring fallback (follow-through).
- Passkey flows run under Playwright with WebAuthn virtual authenticator (follow-through).

## Common tasks

| Task | Command |
|---|---|
| Typecheck | `pnpm --filter @sveltesentio/auth typecheck` |
| Unit tests | `pnpm --filter @sveltesentio/auth test` |
| E2E (WebAuthn virtual authenticator) | `pnpm --filter @sveltesentio/auth test:e2e` |

## Related

- [docs/migrations/downstream-antipatterns-v0.1.md](../../docs/migrations/downstream-antipatterns-v0.1.md) — revenge auth antipatterns (items 1–2) remediated here.
- [docs/principles.md](../../docs/principles.md) §2.2 — OWASP ASVS L2 invariants this package enforces.
