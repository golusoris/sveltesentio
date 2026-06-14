# @sveltesentio/shell

> Device-class shell — `classifyDevice` presets, D-pad/Gamepad focus graph, Tailwind 4 safe-area helpers, optional `@vite-pwa/sveltekit` registration.

## Status

**v0.1.0** — device-class + dpad + safe-area land. Locked through [ADR-0027](../../docs/adr/0027-custom-focus-graph-10foot.md) (focus graph), [ADR-0028](../../docs/adr/0028-vite-pwa-sveltekit.md) (PWA), [ADR-0029](../../docs/adr/0029-tailwind4-safe-area-utilities.md) (safe-area).

## Sub-exports

| Sub-export | Contents |
|---|---|
| `./device-class` | `classifyDevice()` → `desktop` / `handheld` / `10foot`; SSR-safe `readDeviceSignals()` |
| `./dpad` | `computeNextFocus()` geometry, key/gamepad input mappers, `dpadNavigation` Svelte action |
| `./safe-area` | `safeAreaInset()`, `cssVars()`, logical-property padding helpers |
| `./pwa` | `registerSW()` wrapper over the optional `virtual:pwa-register` module |

## Device classification

```ts
import { classifyDevice, readDeviceSignals } from '@sveltesentio/shell/device-class';

const cls = classifyDevice(readDeviceSignals());
// 'desktop' | 'handheld' | '10foot' — feed straight into the ui interface preset.
```

| Signals | Result |
|---|---|
| `tv: true` (any) | `10foot` |
| coarse pointer, width ≥ 1280 | `10foot` (TV remote) |
| coarse pointer, width < 1280 | `handheld` |
| fine pointer, width < 1024 | `handheld` |
| fine pointer, width ≥ 1024 | `desktop` |

## D-pad / Gamepad focus graph

`computeNextFocus` is pure geometry — pick the nearest well-aligned neighbour by
rect centres, penalising off-axis drift. `dpadNavigation` is a thin `use:` action
that drives it from `keydown` **and** the Gamepad API (standard-mapping D-pad
buttons 12–15 + left-stick with a deadzone). One cell per discrete press;
hold-to-repeat lives upstream (reduced-motion-friendly).

```svelte
<script lang="ts">
  import { dpadNavigation, type FocusCandidate } from '@sveltesentio/shell/dpad';

  let focused = $state<string | null>('home');
  const candidates = (): FocusCandidate[] => /* live rects from registered cells */ [];
</script>

<div
  use:dpadNavigation={{
    candidates,
    current: () => focused,
    focus: (id) => (focused = id),
  }}
>
  …
</div>
```

`computeNextFocus` returns `null` when the graph has no neighbour in the move
direction — focus stays put (fail loud, no silent wrap-around).

## Safe-area

CSS-only, logical-property helpers that pair with the Tailwind 4 `@utility`
safe-area tokens (ADR-0029) and a `viewport-fit=cover` meta tag.

```ts
import { cssVarsString } from '@sveltesentio/shell/safe-area';

// Floor the top inset for TV overscan, which has no env() value on most platforms.
const style = cssVarsString({ top: '2dvh' });
// '--ss-safe-top:max(env(safe-area-inset-top), 2dvh);--ss-safe-right:env(safe-area-inset-right);…'
```

## PWA (optional)

`@vite-pwa/sveltekit` / `vite-plugin-pwa` are **optional** peers. `registerSW`
lazily imports `virtual:pwa-register`; without the plugin configured it resolves
to a no-op and logs a warning rather than throwing. SSR-safe.

```ts
import { registerSW } from '@sveltesentio/shell/pwa';

const update = await registerSW({
  immediate: true,
  onNeedRefresh: () => showUpdatePrompt(),
});
// call update() from the prompt to reload into the new service worker.
```

## Related ADRs

- [ADR-0027](../../docs/adr/0027-custom-focus-graph-10foot.md) — custom focus-graph D-pad router.
- [ADR-0028](../../docs/adr/0028-vite-pwa-sveltekit.md) — PWA layer via `@vite-pwa/sveltekit`.
- [ADR-0029](../../docs/adr/0029-tailwind4-safe-area-utilities.md) — Tailwind 4 safe-area helpers + `viewport-fit=cover`.
