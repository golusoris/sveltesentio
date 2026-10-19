# @sveltesentio/testing — AGENTS.md

> Cross-package test helpers. Phase orthogonal — consumed by every other `@sveltesentio/*` package.

## Scope

### Landed (v0.0.1)

| Sub-export         | Contents                                                                                                                                                                                                                                                                                                                  | ADR                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `./clock`          | `testClock({ now })` + `TestClock` interface (`advance`, `set`) implementing `@sveltesentio/core/clock` `Clock`                                                                                                                                                                                                           | [ADR-0052](../../docs/adr/0052-clock-injection-hybrid.md) |
| `./a11y`           | `axeDefaults` (WCAG 2.2 AA tag set), `mergeAxeOptions(...)`, `filterViolationsByImpact`, `assertNoViolations(results, opts?)`, `AxeViolationsError`. Pure-data + assertion surface — `axe-core` + `vitest-axe` = consumer-installed dev-deps fed into assertion.                                                          | [ADR-0031](../../docs/adr/0031-a11y-testing-lane.md)      |
| `./playwright-axe` | `playwrightAxeDefaults`, `axeConfig({impactsFail, disableRules, tags})`, `filterPlaywrightViolations`, `applyAxeConfig(builder, config)` (wires `withTags` + `disableRules` onto `AxeBuilder`-shaped object).                                                                                                             | [ADR-0031](../../docs/adr/0031-a11y-testing-lane.md)      |
| `./fixtures`       | RFC 9457 builders: `validationProblem({fields})`, `authProblem`, `forbiddenProblem`, `notFoundProblem`, `rateLimitedProblem({retryAfterSeconds?})`, `serverErrorProblem`, raw `problemError(init)`, `problemResponse(err, {headers?})` (returns `Response` with `application/problem+json`).                              | —                                                         |
| `./locale-parity`  | In-memory message catalog parity checkers and assertions: `compareLocales(base, other)` (`missingKeys`, `extraKeys`, `emptyValues`, `placeholderMismatches`), `keySet`, `missing`, `placeholders`, `findEmptyValues`, `getValue`, `assertLocaleParity(catalogs, { base })`. Bound to `MAX_NODES` nodes without recursion. | —                                                         |

### Follow-through (not in v0.0.1)

| Sub-export   | Contents                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------------- |
| `./forms`    | Superforms fixture factory — initial-state + action-result round-trip helpers tied to `@sveltesentio/forms` |
| `./query`    | TanStack Query SSR hydration assertions — depends on Phase 4 query finishing (#33)                          |
| `./contrast` | Token-pair contrast gate — depends on `@sveltesentio/ui/tokens` shipping (Phase 3 finishing #32)            |

## Invariants

- **Never ship in production bundles.** `sideEffects: false` + consumers import only from `test/` or `vitest.config.ts`. Tree-shakers drop whole package from app builds.
- **Stay framework-agnostic where possible** — helpers work under Vitest, node:test, or Playwright without forced coupling. `vitest` = **optional** peerDep.
- **Mirror production API shapes exactly.** `testClock` implements `Clock` interface byte-for-byte — swap with `setClock` / `withClock` mechanical.
- **No hidden global state.** Helpers return fresh instances per call; no module-level mutation. Exception: integration harnesses explicitly needing `vi.useFakeTimers()` — scoped with `beforeEach` / `afterEach`.

## Canonical recipes

### Component test — deterministic `useClock()`

```ts
import { render } from '@testing-library/svelte';
import { testClock } from '@sveltesentio/testing/clock';
import { setClock } from '@sveltesentio/core/clock';
import MyComponent from '../src/MyComponent.svelte';

it('formats the current time', () => {
  const clock = testClock({ now: new Date('2026-04-17T12:00:00Z') });
  // bind inside the root during test render
  const { getByTestId } = render(MyComponent, {
    context: new Map([[Symbol.for('sveltesentio.clock'), clock]]),
  });
  expect(getByTestId('timestamp').textContent).toBe('2026-04-17T12:00:00.000Z');
  clock.advance(60_000);
  // re-render or tick to observe rolled-forward value
});
```

### Hook / server test — `withClock` binding

```ts
import { withClock } from '@sveltesentio/core/clock';
import { testClock } from '@sveltesentio/testing/clock';

const clock = testClock({ now: new Date('2026-04-17T12:00:00Z') });
const handle = withClock(clock);
// drive a fake RequestEvent through handle; assert downstream getClock().now()
```

## Test policy

- Helpers unit-tested — `testClock({ now }).now()` must equal `now` on construction; `advance(ms)` must return new Date n ms later; etc.
- No network, no database, no filesystem in helper implementations.
- a11y assertion tested with synthetic `AxeViolation` records — no `axe-core` invocation in package test suite (consumers run real axe; package owns defaults + filter + throw).
- Playwright-axe wrapper tested against `vi.fn()` `AxeBuilderLike` double — no `@axe-core/playwright` install required to verify chaining.
- Fixtures emit real `ProblemError` instances backed by `@sveltesentio/core` -> consumers assert against same class app code throws.
- Coverage target ≥ 90 % — regressions silently corrupt every consumer test suite. **41 tests landed across 4 files.**

## Common tasks

| Task       | Command                                         |
| ---------- | ----------------------------------------------- |
| Typecheck  | `pnpm --filter @sveltesentio/testing typecheck` |
| Unit tests | `pnpm --filter @sveltesentio/testing test`      |

## Related ADRs

- [ADR-0052](../../docs/adr/0052-clock-injection-hybrid.md) — clock injection; `testClock` mirrors interface.
- [ADR-0031](../../docs/adr/0031-a11y-testing-lane.md) — a11y testing lane (vitest-axe + Playwright axe).

## Related memory feedback

- "Integration tests must hit a real database" (feedback from prior session) — package **must not** encourage mocking at wrong layer. Mocks + fixtures belong in-process test-doubles for **our own** clock / ambient utilities, never for shared infrastructure production depends on.
