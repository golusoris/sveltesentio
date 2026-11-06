# @sveltesentio/auth — AGENTS.md

> Custom thin OIDC client + passkeys + session cookies + permission runes + MFA UI. No third-party auth framework. Phase 7 per `.workingdir/PLAN.md`.

## Scope

No third-party auth framework (openid-client, oidc-client-ts, Auth.js). ID token validation = `oauth4webapi` exact pin; never hand-rolled JOSE ([ADR-0057](../../docs/adr/0057-oidc-id-token-validation-oauth4webapi.md)).

### Landed exports

Full API: `src/index.ts`. Key ADRs: [ADR-0032](../../docs/adr/0032-custom-oidc-client-against-golusoris.md) (OIDC PKCE), [ADR-0034](../../docs/adr/0034-httponly-cookie-sessions.md) (CSRF + cookies), [ADR-0035](../../docs/adr/0035-load-derived-permissions.md) (permissions), [ADR-0036](../../docs/adr/0036-mfa-ui-structured-errors.md) (MFA UI), [ADR-0057](../../docs/adr/0057-oidc-id-token-validation-oauth4webapi.md) (token validation), [ADR-0033](../../docs/adr/0033-simplewebauthn-passkeys.md) (passkeys).

- v0.0.1: PKCE S256, state/nonce generators, CSRF token issue/verify, timing-safe compare, cookie options, permission factory, base64url primitives.
- v0.2.0: `buildAuthorizationUrl`, `createAuthorizationRequest`, `exchangeAuthorizationCode` (oauth4webapi), `handleCsrf` hook, `evaluateCsrf`, `handleAuthError` (MFA narrowing), passkey register/authenticate wrappers.
- v0.6.0: `usePermissions()` rune, `<MfaChallenge>` / `<MfaEnroll>` components.

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
  import { usePermissions } from '@sveltesentio/auth/use-permissions';
  const { can } = usePermissions();
</script>

{#if can('billing.read')}<BillingPanel />{/if}
```

## Sub-exports

Barrel: `@sveltesentio/auth`. Granular: `auth/csrf`, `auth/cookies`, `auth/pkce`, `auth/random`, `auth/permissions`, `auth/oidc`, `auth/csrf-hook`, `auth/mfa`, `auth/passkey`, `auth/session`, `auth/mfa-view`, `auth/use-permissions`, `auth/mfa-challenge`, `auth/mfa-enroll`. Full map: `package.json` `exports` field.

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
