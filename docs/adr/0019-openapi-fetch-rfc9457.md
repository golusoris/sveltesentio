# ADR-0019: `openapi-fetch` + RFC 9457 middleware for typed HTTP against Golusoris

- **Status**: Proposed
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D14 in `.workingdir/research/decisions-needed.md`

## Context

Golusoris emits RFC 9457 `application/problem+json` errors via `ogenkit`. SvelteKit consumers need a tiny, type-first HTTP client that honours that error shape without code-generating an entire client runtime. subdo already pins `openapi-fetch@0.17.0`.

## Decision

Lock `openapi-fetch@^0.17` + `openapi-typescript` (dev) inside `@sveltesentio/core/http`. Ship a framework middleware that intercepts non-2xx responses, parses `problem+json` via a Zod-narrowed discriminated union, and throws a typed `ProblemError` carrying `type`/`title`/`status`/`detail`/`instance`/extensions. Consumers get `const { data, error } = await client.GET("/v1/x")` with `error` fully narrowed.

## Alternatives considered

- **`@hey-api/openapi-ts`** — ships a generated client runtime that overlaps `@sveltesentio/query` responsibilities; bigger surface for no gain.
- **`orval`** — heavier generator, bundles React Query adapters; SvelteKit adapter story weaker than openapi-fetch.
- **Hand-written `fetch` + Zod** — loses path-param type-checking and query-string inference that openapi-fetch provides from the OpenAPI doc.

## Consequences

**Positive**:
- 1:1 fidelity with Golusoris `ogenkit` error contract (RFC 9457).
- Zero code generation of runtime — only types emitted from `openapi-typescript`.
- subdo's existing pin aligns without migration.

**Negative / trade-offs**:
- Middleware becomes a thin new surface we own.
- openapi-fetch relies on OpenAPI 3.1 input — spec generation is Golusoris's job.

**Documentation obligations**:
- `docs/compose/http-client.md` — middleware authoring, `ProblemError` narrowing, retries.
- `@sveltesentio/core` AGENTS.md — pinned matrix (`openapi-fetch` × Zod v4 schema).

## Evidence

- `.workingdir/research/ecosystem-pass-1-summary.md:48` — D14 pick + verified `openapi-fetch@0.17.0` MIT on npm.
- `.workingdir/research/ecosystem-batch-a.md` — middleware shape + rejection of `@hey-api/openapi-ts` and `orval`.
- `.workingdir/research/deepread-subdo.md` — subdo already on `openapi-fetch@0.17.0`.
- Golusoris `ogenkit` §2.6 — RFC 9457 emission confirmed.
