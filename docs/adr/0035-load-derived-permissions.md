# ADR-0035: Per-route `load`-derived permissions; no global `$permissions` rune

- **Status**: Proposed
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D63 in `.workingdir/research/decisions-needed.md`

## Context

Permissions come from the server (Golusoris role + resource checks). The choices for surfacing them to SvelteKit components:

1. Load in `+layout.server.ts` → flow through `page.data` → consume via `$derived($page.data.permissions)`.
2. Populate a global `$permissions` rune on app start, mutate on route change.

Option 2 creates a server-state store — exactly what ADR-0008 (TanStack Query) and CLAUDE.md ban ("no `writable()` for server state"). It also hides when permissions are fetched, making SSR and hydration fragile.

## Decision

SvelteKit-canonical pattern only:

- `+layout.server.ts` (or per-route `+page.server.ts`) loads permissions via `@sveltesentio/auth/permissions.load()`.
- `page.data.permissions` carries a typed shape.
- `@sveltesentio/auth` ships `usePermissions()` returning a `$derived` view of `page.data.permissions` with typed checks: `can('edit', resource)`.
- No global store, no module-level mutable state.

## Alternatives considered

- **Global `$permissions` rune** — server state in a client-side store; violates ADR-0008 + CLAUDE.md.
- **TanStack Query for permissions** — viable but redundant; permissions are load-time data, not streaming server state.
- **Route guards via middleware** — Golusoris does the server-side guard; the SvelteKit side is presentation only.

## Consequences

**Positive**:
- Permissions always flow from server → load → page, matching SvelteKit's data model.
- Hydration is correct by construction; no rune rehydration dance.
- Typed `can(action, resource)` reads naturally in components.

**Negative / trade-offs**:
- Permissions require an explicit `load` in every layout that needs them; depends on server-side `parent()` for inheritance.
- Cross-route imperative checks (rare) must read `page.data` through a small helper.

**Documentation obligations**:
- `docs/compose/permissions.md` — `load` recipes, per-route vs layout scope.
- `@sveltesentio/auth/permissions` AGENTS.md — `usePermissions` API.

## Evidence

- `.workingdir/research/ecosystem-pass-1-summary.md:79` — D63 pick.
- ADR-0008 + CLAUDE.md — no writable for server state.
- SvelteKit 2 docs — `page.data` inheritance via `load`.
