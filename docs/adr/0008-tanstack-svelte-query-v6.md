# ADR-0008: `@tanstack/svelte-query@6` for server state

- **Status**: Proposed
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D30 in `.workingdir/research/decisions-needed.md`

## Context

Server-state handling splits across downstream apps: arca and revenge both ship `@tanstack/svelte-query@^6`; subdo and Lurkarr use module-level `$state` with stale-time caching instead. arca has Query in deps but hand-rolls most fetches; revenge uses it first-class with a 2-min staleTime + concurrent refresh memoization. The framework needs a pinned version where Query **is** used — without mandating it on apps that prefer plain `$state`.

## Decision

Pin `@tanstack/svelte-query@^6` as the server-state solution for `@sveltesentio/query` and any module that ships query helpers. Adoption is **optional**: the framework documents plain `$state` module patterns as equally valid for simple load-save (see D40 / ADR-0003 + Lurkarr's evidence). `@sveltesentio/query` supplies rune-friendly wrappers + SSR hydration helpers for adopter apps.

## Alternatives considered

- **Require TanStack Query framework-wide** — repels Lurkarr + subdo's module-`$state` pattern; forces refactor without payoff.
- **`svelte-query` community port** — abandoned; TanStack is the maintained track.
- **Plain `$state` only** — loses arca + revenge's query primitives (infinite-query, invalidation, concurrent refresh).
- **Custom rune-based fetcher** — reinvents a mature library.

## Consequences

**Positive**:
- Matches arca + revenge's pinned version exactly.
- Rune wrappers remove the boilerplate arca complained about (deps present but unused).
- Revenge's 2-min staleTime + refresh-memoization pattern is a reusable preset.

**Negative / trade-offs**:
- Two documented server-state paths (Query vs module `$state`); `docs/compose/server-state.md` must clearly delineate when to pick which.
- SPA-only apps (revenge, Lurkarr, subdo) bypass SSR hydration entirely; arca is the only SSR consumer. Hydration tests must cover both paths.

**Documentation obligations**:
- `docs/compose/server-state.md` — rune wrapper vs plain `$state` decision flowchart.
- `@sveltesentio/query` AGENTS.md — SSR hydration recipe (arca) vs SPA bypass (revenge/Lurkarr/subdo).

## Evidence

- `.workingdir/research/deepread-arca.md:13,50` — `@tanstack/svelte-query@6`, "TanStack Query in deps but unused" (rune wrapper would remove boilerplate).
- `.workingdir/research/deepread-revenge.md:13,40-42,206` — `@tanstack/svelte-query@^6.0.18`, 2-min staleTime + retry:1 pattern.
- `.workingdir/research/deepread-lurkarr.md:31,92-110,317` — No TanStack Query, module `$state` pattern used instead.
- `.workingdir/research/deepread-subdo.md:28` — No TanStack Query in subdo.
- `.workingdir/research/decisions-needed.md:221` — convergence row: "@tanstack/svelte-query v6" (2/2 adopters).
- `.workingdir/research/decisions-needed.md:263` — SPA-only apps bypass SSR hydration; only arca applicable.
- `.workingdir/research/decisions-needed.md:296` — user closure.
