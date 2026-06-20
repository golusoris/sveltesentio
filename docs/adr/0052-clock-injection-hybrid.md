# ADR-0052: Clock injection — hybrid context-rune + `AsyncLocalStorage` module singleton

- **Status**: Accepted
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D13 in `.workingdir/research/decisions-needed.md`
- **Research**: [d13-clock-injection.md](../../.workingdir/research/d13-clock-injection.md)

## Context

Golusoris's Go side uses fx-injected `Clock` so every handler/worker reads the ambient clock without threading arguments. SvelteKit + Svelte 5 needs matching ergonomics:

- Component code consumes time via a runes-native helper (`useClock()`).
- Non-component server code (`+server.ts`, `hooks.server.ts`, utility modules, DB adapters) must also see the request-scoped Clock.
- Hydration must not produce client/server mismatch on `Date.now()`-derived views.

Two candidates were on the table — context-only vs. module-singleton-over-`AsyncLocalStorage`. Live-docs research (see linked report) confirms neither dominates alone.

## Decision

**Hybrid**, shipped in `@sveltesentio/core/clock`:

1. **`setClock(clock: Clock)`** — root-layout binding. Calls `setContext(CLOCK_KEY, clock)` for the component tree; on the browser also updates a tab-scoped module singleton. On the server, the SvelteKit `handle` hook separately calls `als.run(clock, …)` around `resolve(event)`.
2. **`useClock()`** — component-tree consumer; reads via `getContext()` during init (runes-native ergonomics).
3. **`getClock()`** — non-component consumer; reads the `AsyncLocalStorage<Clock>` store on the server, the tab singleton on the browser.
4. **`withClock(clock)`** — factory returning a `Handle` that wraps every request in `als.run(clock, …)` + populates `event.locals.clock`. Apps compose this in `hooks.server.ts` via `@sveltejs/kit/hooks` `sequence()`.
5. **Hydration idiom** — root `+layout.server.ts` returns `{ serverNow: getClock().now() }` (devalue serializes `Date` natively); root `+layout.svelte` wraps the default browser Clock via `createHydrationClock(serverNow)` which replays the SSR timestamp on the first `now()` call, then rolls forward via `performance.now()` deltas. Guarantees byte-identical first render.

All `Date.now()` / `new Date()` / `performance.now()` stays banned in package source outside `test/` (existing eslint rule) — consumers route through the injected Clock.

## Alternatives considered

- **Context-only** — breaks for `+server.ts`, `load` utilities, and any async path escaping the component tree. Svelte docs explicitly scope context to "component hierarchy".
- **`AsyncLocalStorage`-only module singleton** — works server-side but has no browser analog and bypasses runes ergonomics. Loses the declarative per-tree override pattern.
- **`event.locals.clock`-only** — canonical SvelteKit but doesn't reach code that lacks `event` in scope; also not usable from components without prop-drilling.
- **Thread `Clock` through every function signature** — mirrors explicit DI but doubles every call site; golusoris already rejected this pattern.

## Consequences

**Positive**:

- Mirrors golusoris's fx-injected ergonomics — one root wire-up, ambient reads.
- Runes-native `useClock()` inside components; correct request scoping outside them via Node 24-stable `AsyncLocalStorage` (Stability: 2 per Node docs).
- Hydration hazard closed: `load` serializes `serverNow`; first browser `$derived` view matches SSR output.
- Tab-scoped module singleton on browser is safe — one JS realm per tab; no cross-request contamination class of bugs exists client-side.

**Negative / trade-offs**:

- Three public entry points (`setClock`, `useClock`, `getClock`) instead of one — documented decisively in the compose recipe.
- Node-only on the server side (no browser ALS); framework commits to Node ≥24 anyway (ADR-0021), so this is aligned.
- `withClock` must be composed with any other `Handle` via `sequence()` — not automatic; recipe shows the canonical form.

**Documentation obligations**:

- `docs/compose/clock-injection.md` — `setClock` / `useClock` / `getClock` recipes, `withClock` in `hooks.server.ts`, hydration idiom with `serverNow`.
- `@sveltesentio/core` AGENTS.md — `Clock` interface, ban on direct `Date`/`performance.now` outside the Clock.
- ESLint rule `@sveltesentio/no-direct-time` stays enabled (extends existing rule).
- Testing helper `testClock({ now: ... })` in `@sveltesentio/testing/clock` for deterministic fixture time in unit + Playwright runs.

## Evidence

- [`.workingdir/research/d13-clock-injection.md`](../../.workingdir/research/d13-clock-injection.md) — live-docs research.
- https://svelte.dev/docs/kit/hooks — `event.locals` canonical population site.
- https://svelte.dev/docs/svelte/context — "Context … is not shared between requests".
- https://svelte.dev/docs/kit/state-management — module-level mutable state antipattern.
- https://svelte.dev/docs/kit/load — devalue serialization (`Date` native).
- https://nodejs.org/docs/latest-v24.x/api/async_context.html — `AsyncLocalStorage` Stability: 2; Node 24 added `defaultValue` + `name` options.
- sveltejs/svelte#11509 + captaincodeman "SvelteKit Hydration Gotcha" — hydration-mismatch precedent.
