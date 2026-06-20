# ADR-0033: `@simplewebauthn/browser@^13` for passkeys (WebAuthn); pairs with go-webauthn

- **Status**: Accepted
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D61 in `.workingdir/research/decisions-needed.md`

## Context

Passkeys (WebAuthn) require a browser-side ceremony wrapper that handles the `PublicKeyCredential` JSON shape servers expect. Golusoris uses `go-webauthn` on the server; the idiomatic browser counterpart is `@simplewebauthn/browser` (same ceremony JSON shape, MIT, actively maintained). Passlock and similar SaaS alternatives offload ceremony to a third-party endpoint — rejected on principle (we own auth).

## Decision

Pin `@simplewebauthn/browser@^13.3.0` inside `@sveltesentio/auth/webauthn`. Ship:

- `<PasskeyRegister>` — registration ceremony, hands options blob from `/auth/webauthn/register/begin`, posts attestation to `/finish`.
- `<PasskeyLogin>` — authentication ceremony, same shape.
- `registerPasskey()` / `loginPasskey()` programmatic helpers for consumers rolling their own UI.

Zero re-implementation of WebAuthn ceremony encoding (base64url, ArrayBuffer ↔ JSON).

## Alternatives considered

- **Hand-rolled WebAuthn** — re-implements base64url + ArrayBuffer marshalling; `@simplewebauthn/browser` is the minimum well-maintained browser surface.
- **Passlock** — SaaS; ceremony runs on Passlock's infra, not ours.
- **Hanko** — full auth SaaS; same objection.

## Consequences

**Positive**:

- 1:1 ceremony JSON alignment with go-webauthn (server-side).
- Browser support matrix stays honest (library owns polyfill warnings for unsupported browsers).
- Small bundle (~10 KB).

**Negative / trade-offs**:

- Upstream major bumps require ADR amendment.
- `@simplewebauthn` monorepo also ships `server/` + `typescript-types/`; we only use `browser/`, but version ranges should align if we add `server/` helpers later.

**Documentation obligations**:

- `docs/compose/passkeys.md` — ceremony flow, fallback UX when passkeys unsupported.
- `@sveltesentio/auth/webauthn` AGENTS.md — component API + browser support notes.

## Evidence

- `.workingdir/research/ecosystem-pass-1-summary.md:77` — D61 pick.
- `.workingdir/research/ecosystem-batch-c.md` — ceremony-shape alignment with go-webauthn.
- `@simplewebauthn/browser@13.3.0` MIT on npm (verified 2026-04-17).
