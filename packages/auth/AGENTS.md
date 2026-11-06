# @sveltesentio/auth — AGENTS.md

> Custom thin OIDC client + passkeys + session cookies + permission runes + MFA UI. No third-party auth framework. Phase 7 per `.workingdir/PLAN.md`.

## Scope

No third-party auth framework (openid-client, oidc-client-ts, Auth.js). ID token validation = `oauth4webapi` exact pin; never hand-rolled JOSE ([ADR-0057](../../docs/adr/0057-oidc-id-token-validation-oauth4webapi.md)).

Landed exports + sub-exports: see [README.md](README.md).

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
