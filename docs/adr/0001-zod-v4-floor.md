# ADR-0001: Zod v4 floor for all sveltesentio schemas

- **Status**: Proposed
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D12 in `.workingdir/research/decisions-needed.md`

## Context

Zod version drift across downstream apps blocks coherent schema sharing: arca + subdo ship `zod@4`, revenge pins `zod@^3.24.0`. Lurkarr ships no Zod at all. Any `@sveltesentio/*` schema published against a v4 API (e.g. `z.email()`, new error shape) would break revenge until revenge upgrades. The framework needs a single floor.

## Decision

Pin `zod@^4` as the floor for every `@sveltesentio/*` package that ships schemas (`core`, `forms`, `auth`, etc.). Framework peerDep: `"zod": "^4"`. Revenge must upgrade from v3 before consuming sveltesentio schemas.

## Alternatives considered

- **v3 floor, let apps upgrade lazily** — breaks arca + subdo; framework cannot use v4-only features (tree-shaking, `z.email()`, refined error shape).
- **Dual-support (v3 + v4)** — Zod v3→v4 broke enough APIs that a shim would be non-trivial; maintenance burden outweighs the one upgrade in revenge.
- **Valibot** (~70% smaller bundle) — would require replacing Zod across 3/4 adopter apps + rewriting Superforms adapter glue; violates the streamlining rule (apps already on Zod).
- **arktype** — no Superforms adapter, not installed anywhere downstream.

## Consequences

**Positive**:
- One schema toolchain framework-wide; shared types between `core`, `forms`, `auth`.
- Tree-shaking improvements from Zod v4 cascade to every consumer.
- Matches arca + subdo today; revenge just bumps one dep.

**Negative / trade-offs**:
- revenge carries a one-time migration cost (breaking changes Zod v3→v4).
- Floor moves forward with future Zod majors; each major is an ADR amendment.

**Documentation obligations**:
- `docs/compose/schemas.md` — idiomatic Zod v4 patterns (refinement, discriminated unions, `z.infer`).
- Migration note in revenge upgrade checklist.

## Evidence

- `.workingdir/research/deepread-revenge.md:14` — `zod@^3.24.0` (v3 outlier).
- `.workingdir/research/deepread-arca.md:17` — `zod@4` in arca deps.
- `.workingdir/research/deepread-subdo.md:9-26` — subdo on Zod v4 via form coercion patterns (Pattern 2 PropertyPanel).
- `.workingdir/research/decisions-needed.md:235` — divergence row: "arca+subdo on v4, revenge on v3".
- `.workingdir/research/decisions-needed.md:282` — user closure "latest, then v4 at least".
