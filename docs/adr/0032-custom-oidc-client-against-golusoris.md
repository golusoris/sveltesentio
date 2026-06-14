# ADR-0032: Custom thin OIDC client against Golusoris `auth/oidc/*`; no third-party auth framework

- **Status**: Proposed
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D60 in `.workingdir/research/decisions-needed.md`

## Context

Golusoris owns OIDC (authorization code + PKCE, refresh, logout) via `auth/oidc/*`. Adding a third-party auth framework (Auth.js / `openid-client` / `oidc-client-ts`) on the SvelteKit side would:
- Duplicate the ceremony logic Golusoris already handles server-side.
- Introduce a second session concept that must be kept in sync.
- Pull in provider-specific adapters sveltesentio does not need.

What's actually needed on the client: a thin typed wrapper around Golusoris's already-HTTP endpoints (start, callback, refresh, logout) plus hooks for SvelteKit `load` functions.

## Decision

`@sveltesentio/auth/oidc` ships a ~200-line thin client:

- `startLogin(providerId, { returnTo })` → redirect to Golusoris `/auth/oidc/start`.
- `handleCallback(url)` → POST to Golusoris `/auth/oidc/callback` (server-side helper in `+server.ts`).
- `refresh()` → POST to Golusoris `/auth/oidc/refresh` (called by HTTP middleware on 401).
- `logout()` → POST to `/auth/oidc/logout` + clear local cookie.
- Types generated from Golusoris's OpenAPI (via ADR-0019 pipeline) — no hand-maintained shapes.

Zero imports of `openid-client` / `oidc-client-ts` / Auth.js.

## Alternatives considered

- **Auth.js (SvelteKit adapter)** — owns a parallel session + provider wiring; duplicates Golusoris.
- **`openid-client`** — Node-side; would require running OIDC ceremonies inside SvelteKit server, taking responsibility from Golusoris.
- **`oidc-client-ts`** — browser-side OIDC; same duplication problem + bigger bundle.

## Consequences

**Positive**:
- Single source of truth for OIDC (Golusoris). SvelteKit is a dumb relay.
- Session lifetime policies (refresh window, revocation) live in one place.
- Smaller client bundle; no `oidc-client-ts` (~30 KB+).

**Negative / trade-offs**:
- Sveltesentio cannot serve apps that don't use Golusoris as their auth backend — explicit scope choice.
- Adding a new Golusoris auth feature (e.g. device-code flow) requires both Go + sveltesentio changes.

**Documentation obligations**:
- `docs/compose/auth-oidc.md` — SvelteKit route recipes (start / callback / refresh middleware).
- `@sveltesentio/auth` AGENTS.md — endpoint contract with Golusoris.
- Migration note for revenge (currently hand-rolls the callback).

## Evidence

- `.workingdir/research/ecosystem-pass-1-summary.md:76` — D60 pick.
- `.workingdir/research/ecosystem-batch-c.md` — rejection reasoning per alternative.
- Golusoris `auth/oidc/` — server-side ownership.
