# Clock injection

Ambient, request-scoped `Clock` that mirrors Golusoris's fx-injected `Clock` ergonomics. One root wire-up; consumers in components, `+server.ts` handlers, `load` functions, and any server-side utility read the same instance without threading it through signatures.

See [ADR-0052](../adr/0052-clock-injection-hybrid.md) for the decision. API lives in `@sveltesentio/core/clock`.

## The four entry points

| Function | Use from | What it does |
|---|---|---|
| `setClock(clock)` | root `+layout.svelte` only | Binds clock to the component tree (`setContext`) and updates the tab-scoped browser singleton. |
| `useClock()` | components, during init | Reads via `getContext`, falls back to the ambient clock outside components. |
| `getClock()` | `+server.ts`, `load`, utilities, DB adapters | Reads the request-scoped `AsyncLocalStorage<Clock>` on server; the tab singleton on browser. |
| `withClock(clock)` | `hooks.server.ts` | Returns a `Handle` that runs each request inside `als.run(clock, …)` and populates `event.locals.clock`. Compose with other handles via `sequence()`. |

## Minimal setup

### 1. Root hook — request-scope the clock on the server

```ts
// src/hooks.server.ts
import { sequence } from '@sveltejs/kit/hooks';
import { systemClock, withClock } from '@sveltesentio/core/clock';

export const handle = sequence(withClock(systemClock));
```

Replace `systemClock` with a test / offset / monotonic-wrapped clock when needed — the same function receives whatever you pass.

### 2. Root server load — serialise `serverNow` for hydration

```ts
// src/routes/+layout.server.ts
import { getClock } from '@sveltesentio/core/clock';

export const load = () => ({ serverNow: getClock().now() });
```

`devalue` handles `Date` natively, so no manual ISO conversion.

### 3. Root layout — bind clock on the client

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import { createHydrationClock, setClock } from '@sveltesentio/core/clock';
  const { data, children } = $props();
  setClock(createHydrationClock(data.serverNow));
</script>

{@render children()}
```

First browser `now()` call returns the SSR timestamp byte-for-byte; subsequent calls roll forward via `performance.now()` deltas. Guarantees a matching first-render.

## Consumer patterns

### Component

```svelte
<script lang="ts">
  import { useClock } from '@sveltesentio/core/clock';
  const clock = useClock();
  const current = $derived(clock.now().toISOString());
</script>

<time datetime={current}>{current}</time>
```

`useClock()` must be called during component init (before any `await` in `<script>`), per Svelte's `getContext` rule.

### `+server.ts` handler

```ts
// src/routes/api/events/+server.ts
import { getClock } from '@sveltesentio/core/clock';

export const POST = async ({ request }) => {
  const body = await request.json();
  return Response.json({ ...body, receivedAt: getClock().now() });
};
```

### `load` function

```ts
// src/routes/dashboard/+page.server.ts
import { getClock } from '@sveltesentio/core/clock';

export const load = () => ({ dashboardOpenedAt: getClock().now() });
```

### Utility module reached from `+server.ts`

```ts
// src/lib/server/audit.ts
import { getClock } from '@sveltesentio/core/clock';

export function stamp<T extends object>(event: T): T & { at: Date } {
  return { ...event, at: getClock().now() };
}
```

No `event` threading required — the `AsyncLocalStorage` store propagates across every `await`.

## Testing

### Unit — deterministic `now`

```ts
import { describe, expect, it } from 'vitest';
import { setClock } from '@sveltesentio/core/clock';

function testClock({ now }: { now: Date }) {
  let t = now.getTime();
  return {
    now: () => new Date(t),
    monotonic: () => t - now.getTime(),
    advance: (ms: number) => { t += ms; },
  };
}

describe('feature', () => {
  it('reads time from the injected clock', () => {
    const clock = testClock({ now: new Date('2026-04-17T12:00:00Z') });
    // bind via setClock inside the render root in component tests,
    // or via withClock(clock) inside hooks.server.ts for integration tests
    // …
    expect(clock.now().toISOString()).toBe('2026-04-17T12:00:00.000Z');
  });
});
```

A first-class `testClock({ now })` helper will ship in `@sveltesentio/testing/clock` (tracked — not yet scaffolded in v0.0.x).

### Integration — fixed clock per request

```ts
// src/hooks.server.ts in test mode
import { sequence } from '@sveltejs/kit/hooks';
import { withClock } from '@sveltesentio/core/clock';
import { testClock } from './test/clock.ts';

export const handle = sequence(
  withClock(testClock({ now: new Date('2026-04-17T12:00:00Z') })),
);
```

## Constraints

- **No `Date.now()` / `new Date()` / `performance.now()` in package source** outside `test/`. The ESLint rule `@sveltesentio/no-direct-time` enforces this; consumers must route through `useClock()` / `getClock()`.
- **Node ≥ 24** — server-side uses `AsyncLocalStorage` with the `name` + `defaultValue` constructor options (Node 24.0.0). Framework-level floor is already Node 24 per [ADR-0021](../adr/0021-node-24-floor.md).
- **Browser has no ALS.** The tab-scoped module singleton is safe because each tab is one JS realm — no cross-request contamination class of bugs exists client-side.
- **`useClock()` only during component init.** Reading from `$effect` or event handlers requires capturing `const clock = useClock()` at the top level first.

## Related

- [ADR-0052](../adr/0052-clock-injection-hybrid.md) — decision record.
- [`.workingdir/research/d13-clock-injection.md`](../../.workingdir/research/d13-clock-injection.md) — live-docs research.
- Golusoris `pkg/clock` — the Go-side injected clock whose ergonomics this mirrors.
