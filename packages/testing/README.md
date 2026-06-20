# @sveltesentio/testing

> Test helpers for the sveltesentio framework. Pre-alpha (v0.1.0).

## Sub-exports

- `@sveltesentio/testing/clock` — `testClock({ now })` deterministic clock compatible with `@sveltesentio/core/clock` [`Clock`](../core/src/clock.ts) interface. See [ADR-0052](../../docs/adr/0052-clock-injection-hybrid.md).
- `@sveltesentio/testing/a11y` — vitest-axe preset surface (WCAG 2.2 AA tags, impact filtering, `assertNoViolations`). See [ADR-0031](../../docs/adr/0031-a11y-testing-lane.md).
- `@sveltesentio/testing/playwright-axe` — `@axe-core/playwright` fixture preset. See [ADR-0031](../../docs/adr/0031-a11y-testing-lane.md).
- `@sveltesentio/testing/fixtures` — RFC 9457 `ProblemError` builders (`validationProblem`, `authProblem`, `notFoundProblem`, ...) for Superforms + API error round-trips.

## Status

- `clock` — shipped.
- `a11y` — shipped.
- `playwright-axe` — shipped.
- `fixtures` — shipped.
- TanStack Query SSR hydration assertions — pending.
