# ADR-0023: `uuid@13` UUIDv7 as the default client-side ID

- **Status**: Accepted
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D11 in `.workingdir/research/decisions-needed.md`

## Context

Golusoris standardises on UUIDv7 + KSUID for trace-continuity across services. Client-side IDs (optimistic inserts, form correlation IDs, upload IDs) must share the same format so that logs/traces line up end-to-end. `uuid@13` exports `v7()` as a first-class entry; nanoid, ulid, and `crypto.randomUUID` (v4) all diverge from the backend format.

## Decision

`@sveltesentio/core/id` exports `newId()` as a thin binding over `uuid.v7()` from `uuid@^13`. Every framework-owned client ID flows through `newId()`. Legacy v4 generation remains available via `newIdV4()` for explicit non-correlation cases (e.g. CSP nonces).

## Alternatives considered

- **`nanoid`** — smaller + URL-safe but breaks Golusoris log correlation; not sortable.
- **`ulid`** — time-sortable like v7 but 26-char Crockford base32; diverges from backend hex format.
- **`crypto.randomUUID()`** (UUIDv4) — zero time-ordering; bad for optimistic-insert persistence indexes.
- **No client-side IDs** — forces round-trip before optimistic UI; rejected in favour of UX parity with arca/subdo.

## Consequences

**Positive**:

- 1:1 ID format with Golusoris traces; no transform at the log sink.
- Time-ordered IDs play nicely with optimistic inserts and cursor pagination.
- Single import path (`@sveltesentio/core/id`) across the framework.

**Negative / trade-offs**:

- `uuid@13` is slightly larger than `crypto.randomUUID`; bundle-size delta measured at <2 KB gzipped and accepted.
- v7 leaks creation timestamp; not a concern in our threat model (IDs are already server-side-visible).

**Documentation obligations**:

- `docs/compose/ids.md` — when to use `newId()` vs server-issued IDs vs v4 nonces.
- `@sveltesentio/core` AGENTS.md — pinned `uuid@^13` + note on `v7()` entry.

## Evidence

- `.workingdir/research/ecosystem-pass-1-summary.md:52` — D11 pick + `uuid@13.0.0` verified MIT.
- Golusoris `id/` package — UUIDv7 + KSUID defaults.
- `.workingdir/research/ecosystem-batch-a.md` — format-alignment reasoning.
