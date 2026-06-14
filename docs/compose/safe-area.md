# Safe-area — Tailwind 4 `@utility` helpers + `viewport-fit=cover`

`@sveltesentio/ui/preset` ships CSS-only safe-area utilities built on
Tailwind 4's `@utility` syntax. Supports iOS PWA notches, Android
edge-to-edge, and TV overscan. `@sveltesentio/shell` injects
`<meta name="viewport" content="viewport-fit=cover, …">` so the insets
actually resolve on iOS.

See [ADR-0029](../adr/0029-tailwind4-safe-area-utilities.md) for the
decision. Related: [ADR-0005](../adr/0005-tailwind-4-with-vite-plugin.md)
(Tailwind 4 + Vite), [ADR-0040](../adr/0040-paraglide-strategy-logical-properties.md)
(logical-property variants for RTL).

## Install

```bash
pnpm add @sveltesentio/ui @sveltesentio/shell
```

Peer range: `tailwindcss@^4`, `svelte@^5`.

## Wire the preset + viewport meta

```ts
// src/app.css
@import 'tailwindcss';
@import '@sveltesentio/ui/preset';
```

```svelte
<!-- src/hooks.server.ts -->
import { sequence } from '@sveltejs/kit/hooks';
import { withViewport } from '@sveltesentio/shell/viewport';

export const handle = sequence(
  withViewport({ fit: 'cover' }), // emits viewport-fit=cover
);
```

Or declare the meta manually in `app.html`:

```html
<meta
  name="viewport"
  content="width=device-width, initial-scale=1, viewport-fit=cover"
/>
```

Without `viewport-fit=cover`, iOS treats the notch/home-indicator as
device chrome and `env(safe-area-inset-*)` resolves to `0px` — the
utilities render but do nothing.

## Utilities

All variants exist as padding, margin, and inset helpers:

| Base utility | CSS |
|---|---|
| `pt-safe-top` | `padding-top: env(safe-area-inset-top)` |
| `pb-safe-bottom` | `padding-bottom: env(safe-area-inset-bottom)` |
| `pl-safe-left` | `padding-left: env(safe-area-inset-left)` |
| `pr-safe-right` | `padding-right: env(safe-area-inset-right)` |
| `px-safe` | shorthand for left + right |
| `py-safe` | shorthand for top + bottom |
| `p-safe` | shorthand for all four |
| `mt-safe-top` … `mr-safe-right` | margin variants |
| `top-safe-top` … `right-safe-right` | inset variants (for `position: fixed/absolute`) |

### `…-or-<n>` variants (floor)

Combine `env()` with a minimum value:

```text
pt-safe-top-or-4      → padding-top: max(env(safe-area-inset-top), 1rem);
pb-safe-bottom-or-6   → padding-bottom: max(env(safe-area-inset-bottom), 1.5rem);
pl-safe-left-or-2     → padding-left: max(env(safe-area-inset-left), 0.5rem);
```

Use when the content needs a baseline padding even when the inset is
`0px` (e.g. on non-notched devices).

### Logical-property variants (RTL-aware)

Pair with [ADR-0040](../adr/0040-paraglide-strategy-logical-properties.md)'s
logical-property posture:

| Logical | Resolves to (LTR) | Resolves to (RTL) |
|---|---|---|
| `ps-safe-start` | `padding-left: env(safe-area-inset-left)` | `padding-right: env(safe-area-inset-right)` |
| `pe-safe-end` | `padding-right: env(safe-area-inset-right)` | `padding-left: env(safe-area-inset-left)` |
| `ms-safe-start` / `me-safe-end` | margin equivalents | |
| `start-safe-start` / `end-safe-end` | inset equivalents | |

Prefer logical variants in new code — they cooperate with RTL without
per-component `dir=` branching.

## Common patterns

### Sticky header / footer on PWA

```svelte
<header class="bg-bg border-border sticky top-0 z-10 border-b pt-safe-top">
  <nav class="px-4 py-3">…</nav>
</header>

<main class="pb-safe-bottom">
  {@render children()}
</main>

<nav class="bg-bg border-border fixed bottom-0 inset-x-0 border-t pb-safe-bottom-or-4 px-safe">
  <!-- bottom tab bar -->
</nav>
```

The bottom nav respects the home-indicator inset on iPhone and falls
back to `1rem` on devices without one (`-or-4`).

### Full-screen media with safe-area caption

```svelte
<figure class="relative">
  <img src={hero.src} alt={hero.alt} class="h-screen w-full object-cover" />
  <figcaption class="absolute inset-x-0 bottom-0 bg-black/60 text-white px-safe pb-safe-bottom-or-4 pt-4">
    {hero.caption}
  </figcaption>
</figure>
```

### 10-foot TV overscan

TVs render to a "safe zone" — content near edges may get cropped by
older displays. iOS-style safe-area insets work on TV platforms that
honor the CSS spec; on platforms that don't, pair with a preset-scoped
minimum:

```css
:root[data-preset='10foot'] {
  --overscan-inset: 5%;
}
```

```svelte
<main class="min-h-screen p-safe" style="padding: max(env(safe-area-inset-top), var(--overscan-inset, 0))">
  …
</main>
```

The `@sveltesentio/ui/preset-10foot` layer sets `--overscan-inset: 5%`
by default.

### Landscape notch (iPhone Pro Max)

In landscape, iOS puts the notch on one side. `px-safe` handles both
edges in one utility — use it on every full-bleed layout rather than
separate `pl-safe-left` + `pr-safe-right`.

## Debug helper

Tailwind 4 `@utility` allows dev-only debug:

```css
/* src/app.css — dev only */
@utility debug-safe {
  outline: 2px solid oklch(0.70 0.15 250);
  outline-offset: calc(-1 * env(safe-area-inset-top));
}
```

Apply `debug-safe` to `<body>` to visualize where the safe area is on
devices without a native overlay.

## What the utilities do NOT do

- **Scroll insets.** Safe-area only adjusts layout padding/margin.
  For scrollable content under a translucent header, pair with
  `scroll-padding-top: env(safe-area-inset-top)`.
- **Absolute positioning fallbacks.** `top-safe-top` renders as
  `top: env(...)` — on browsers without `env()` (extremely old), it
  falls back to `top: 0`. The Tailwind 4 preset's browser floor matches
  the oklch floor (Safari ≥15.4, Chrome ≥111, Firefox ≥113).
- **Dynamic viewport adjustments.** Use `svh` / `dvh` units for that
  (see next section).

## `dvh` / `svh` / `lvh` for dynamic viewports

Safe-area insets cover device chrome; the dynamic viewport unit covers
the retractable browser UI (mobile Safari URL bar). Combine:

```svelte
<main class="min-h-[100dvh] pb-safe-bottom">
  <!-- content fills the dynamic viewport; padding sits above the home indicator -->
</main>
```

Tailwind 4 ships `dvh` / `svh` / `lvh` natively. No additional utility
from the preset.

## Testing

Playwright emulates device chrome via viewport sizes but does **not**
emulate safe-area insets. Test on real devices or use `--debug-safe`
to set the env-like values in CSS:

```css
/* playwright fixture */
:root {
  --env-safe-area-inset-top: 44px;     /* iPhone 14 Pro notch */
  --env-safe-area-inset-bottom: 34px;  /* home indicator */
}
```

The preset's utilities can optionally read these dev vars via the
`SAFE_AREA_DEV` build flag. Document in your fixture; production always
uses `env()`.

## Anti-patterns

- **Using `safe-area-inset-*` without `viewport-fit=cover`.** On iOS
  the insets resolve to `0px`. Insert the meta tag.
- **Using fixed pixels on the bottom nav.** `padding-bottom: 16px`
  collides with the home indicator on iPhone. Use `pb-safe-bottom-or-4`.
- **Wrapping in `@supports (padding: env(...))`.** Fallback's not
  needed — the framework browser floor supports `env()` everywhere.
- **Applying `p-safe` to every container.** Scope to the outermost
  elements that border the viewport. Nested `p-safe` double-pads.
- **Using `pl-safe-left` / `pr-safe-right` over `ps-safe-start` /
  `pe-safe-end`.** Logical-property variants are RTL-correct; directional
  variants aren't. Prefer logical unless you explicitly mean "left" as
  a visual direction.
- **Setting a custom `safe-area-inset-*` via CSS var.** The values come
  from the OS / browser chrome — spoofing them breaks iOS PWA.

## References

- ADR-0029 — Tailwind 4 `@utility` safe-area decision.
- ADR-0005 — Tailwind 4 + Vite plugin.
- ADR-0040 — Paraglide + logical-property posture.
- MDN `env()`: <https://developer.mozilla.org/en-US/docs/Web/CSS/env>.
- MDN `viewport-fit`: <https://developer.mozilla.org/en-US/docs/Web/CSS/@viewport/viewport-fit>.
- Tailwind 4 `@utility`: <https://tailwindcss.com/docs/adding-custom-styles>.
