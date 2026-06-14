# @sveltesentio/testing

> Test helpers for the sveltesentio framework. Pre-alpha (v0.0.x).

## Sub-exports

- `@sveltesentio/testing/clock` — `testClock({ now })` deterministic clock compatible with `@sveltesentio/core/clock` [`Clock`](../core/src/clock.ts) interface. See [ADR-0052](../../docs/adr/0052-clock-injection-hybrid.md).
- `@sveltesentio/testing/a11y` — vitest-axe + @axe-core/playwright harness. See [ADR-0031](../../docs/adr/0031-a11y-testing-lane.md). **Pending** — awaiting config-surface settle.

## Status

- `clock` — shipped.
- `a11y` — stub.
- Superforms fixture + TanStack Query SSR hydration assertions — pending.
