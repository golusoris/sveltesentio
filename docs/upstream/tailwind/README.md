---
pinned-version: 4.x
canonical-url: https://tailwindcss.com/docs
last-verified: 2026-04-18
---

# Tailwind CSS — v4.x snapshot

Pinned: **`tailwindcss ^4.0.0`** (peerDependency in `@sveltesentio/ui`)
Canonical: https://tailwindcss.com/docs

Tailwind 4 is a ground-up rewrite. Most v3 patterns no longer apply. **Do not** suggest `tailwind.config.js`, `@tailwind base/components/utilities`, or PostCSS-plugin syntax — these are v3.

## Single import

```css
/* app.css */
@import "tailwindcss";
```

That single line replaces `@tailwind base; @tailwind components; @tailwind utilities;`.

## CSS-first configuration

Configuration moves from JS to CSS via `@theme`:

```css
@import "tailwindcss";

@theme {
  --color-primary: oklch(0.65 0.2 150);
  --color-surface: oklch(0.98 0.01 250);
  --font-display: "Inter", sans-serif;
  --spacing: 0.25rem;             /* base spacing unit */
  --breakpoint-3xl: 1920px;       /* adds 3xl: variant */
  --radius-card: 0.75rem;
}
```

Each token automatically generates utilities: `bg-primary`, `text-primary`, `font-display`, `rounded-card`, `3xl:flex`, etc.

## Vite plugin

```ts
// vite.config.ts
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()]
});
```

No `postcss.config.js`, no `tailwind.config.js` for typical use.

## Custom variants

```css
@custom-variant dark (&:where(.dark, .dark *));
@custom-variant data-active (&[data-active="true"]);
```

Use as `dark:bg-surface`, `data-active:ring-2`.

## Container queries (built-in, no plugin)

```html
<div class="@container">
  <div class="@md:flex @lg:grid-cols-3">…</div>
</div>
```

## Arbitrary values + CSS variables

```html
<div class="bg-[--color-primary] grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]">…</div>
```

## `sveltesentio` usage

- `@sveltesentio/ui` ships a preset CSS file consumed via `@import "@sveltesentio/ui/preset.css"`. Per-interface-type presets (desktop / 10-foot / handheld) override `@theme` tokens.
- Design tokens live in `packages/ui/src/tokens/` and emit to the preset at build time.
- `mode-watcher` provides the `dark` class toggle; the `dark` custom variant above wires it.

## Gotchas

- **No `tailwind.config.{js,ts}`** in v4 (still supported via `@config "./legacy.config.js";` for migration only — do not introduce new ones).
- `theme()` function in CSS is removed; reference `var(--color-…)` directly.
- Default colour palette is now in `oklch()`, not `hsl()`. Custom themes should match.
- Plugins API rewritten — most v3 plugins are unported; check upstream before adopting.
- `@apply` still works but is discouraged in component CSS — prefer utility classes in markup or a Svelte snippet.

## Links

- v3 → v4 upgrade: https://tailwindcss.com/docs/upgrade-guide
- `@theme` reference: https://tailwindcss.com/docs/theme
- Vite plugin: https://tailwindcss.com/docs/installation/using-vite
