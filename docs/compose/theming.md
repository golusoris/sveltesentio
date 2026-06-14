# Theming — oklch tokens + Tailwind 4

Every color in `@sveltesentio/ui` is defined in [oklch](https://oklch.com)
inside a Tailwind 4 `@theme` block. No HSL fallback. No hex. This recipe
documents authoring conventions, WCAG-contrast ratios per token, and how
consumers override tokens for brand or tenant theming.

See [ADR-0005](../adr/0005-tailwind-4-with-vite-plugin.md) (Tailwind 4 + Vite
plugin), [ADR-0006](../adr/0006-oklch-only-color-tokens.md) (oklch-only
decision), [ADR-0046](../adr/0046-three-tier-theming.md) (three-tier
theming), [ADR-0048](../adr/0048-cookie-backed-dark-mode.md) (flash-free
dark mode).

## Why oklch

| Criterion | oklch | HSL | hex |
|---|---|---|---|
| Perceptual uniformity | ✅ same L value ≈ same visual lightness | ❌ same L, different visual | ❌ |
| Gamut (P3 displays) | ✅ native | ❌ sRGB only | ❌ sRGB only |
| Contrast reasoning | ✅ swap `L`, chroma + hue stable | ❌ shifts visually | ❌ |
| Browser support | 99%+ of evergreen | 100% | 100% |

Browser floor: **Safari ≥ 15.4, Chrome ≥ 111, Firefox ≥ 113**. Pre-floor
kiosk / embedded webviews must check their Chromium version before
deploying — `@sveltesentio/ui` banners this at build-time.

## Token authoring

Tokens live in `@sveltesentio/ui/tokens` and are exposed as CSS custom
properties under `@theme`. Channels in order: `L C H` (`0..1`, `0..0.4+`,
`0..360`).

```css
/* packages/ui/src/tokens/base.css — framework default */
@theme {
  --color-bg: oklch(0.98 0.002 250);
  --color-fg: oklch(0.18 0.015 250);
  --color-accent: oklch(0.70 0.15 250);
  --color-accent-fg: oklch(0.99 0 0);
  --color-muted: oklch(0.94 0.005 250);
  --color-muted-fg: oklch(0.48 0.01 250);
  --color-border: oklch(0.88 0.008 250);
  --color-ring: oklch(0.70 0.15 250 / 0.5);
  --color-success: oklch(0.72 0.16 155);
  --color-warning: oklch(0.80 0.16 85);
  --color-danger: oklch(0.66 0.22 28);
}
```

### Naming convention

- `--color-<role>` for surface roles (`bg`, `fg`, `accent`, `muted`,
  `border`, `ring`).
- `--color-<role>-fg` for the foreground that pairs with the role
  (contrast ≥ 4.5:1 small text, ≥ 3:1 large text).
- `--color-<semantic>` for status (`success`, `warning`, `danger`, `info`).
- No raw component references (`--color-button-primary` — bad; buttons
  derive from `--color-accent`).

### Contrast contract

Every shipped token pair is WCAG 2.2 AA:

| Pair | Ratio target |
|---|---|
| `fg` on `bg` | ≥ 7:1 (AAA) |
| `accent-fg` on `accent` | ≥ 4.5:1 |
| `muted-fg` on `muted` | ≥ 4.5:1 |
| `success`, `warning`, `danger` on `bg` | ≥ 3:1 (non-text UI) + never sole cue |

A CI axe-core check on every Histoire story enforces this. If you author a
new token, run `pnpm run check:contrast` before pushing.

## Dark mode

Cookie-backed, SSR-injected, flash-free. One root `data-theme` attribute on
`<html>`; Tailwind 4 reads it via `@theme` + CSS custom properties.

```css
/* base.css continued */
:root[data-theme='dark'] {
  --color-bg: oklch(0.16 0.015 250);
  --color-fg: oklch(0.96 0.005 250);
  --color-accent: oklch(0.78 0.14 250);
  --color-accent-fg: oklch(0.12 0.01 250);
  --color-muted: oklch(0.24 0.01 250);
  --color-muted-fg: oklch(0.70 0.008 250);
  --color-border: oklch(0.30 0.012 250);
  /* …etc */
}
```

Server-inject via `hooks.server.ts`:

```ts
import { sequence } from '@sveltejs/kit/hooks';
import { withTheme } from '@sveltesentio/ui/theme-toggle';

export const handle = sequence(withTheme({ cookie: 'theme', default: 'system' }));
```

This rewrites `<html>` with `data-theme="dark"` (or `light`) before the
first paint — no FOUC. See [theming-flash-free.md](theming-flash-free.md)
(pending) for the cookie-shape contract.

## Overriding tokens per tenant

Tenant theming uses a three-tier override: framework base → app brand →
tenant. Each tier is a separate CSS layer so specificity is predictable.

```css
/* app/src/tokens/brand.css — app-level override */
@theme {
  --color-accent: oklch(0.70 0.19 28); /* brand red */
}

/* tenant-resolved at runtime via @sveltesentio/ui/tenant */
:root[data-tenant='acme'] {
  --color-accent: oklch(0.70 0.14 200); /* acme cyan */
}
```

See [tenant-theming.md](tenant-theming.md) (pending) for the resolver
contract + SSR injection recipe.

## Tailwind 4 bridge

Tokens become Tailwind color utilities automatically via the `@theme`
block:

```html
<button class="bg-accent text-accent-fg hover:bg-accent/90">Save</button>
```

No `tailwind.config.js` entry. Tailwind 4 reads `@theme` directly.

For cases where you need the raw CSS value (rare — prefer utilities):

```css
.custom {
  background: var(--color-accent);
  outline: 2px solid var(--color-ring);
}
```

## Per-interface presets

The desktop / 10-foot / handheld / dashboard presets
(`@sveltesentio/ui/preset-*`) override spacing, typography, target-size,
and focus-ring thickness — but they **do not** override color tokens. One
brand, one palette, across every interface. See
[ADR-0047](../adr/0047-per-interface-presets.md).

10-foot preset example:

```css
/* 10-foot adds bolder ring + higher min contrast */
:root[data-preset='10foot'] {
  --ring-width: 3px; /* default 2px */
  --color-ring: oklch(0.70 0.15 250 / 0.75); /* higher opacity */
}
```

## Anti-patterns

- **Hex / HSL in component source.** Forbidden by lint. Use tokens.
- **Inlining `color-mix()` as brand tint.** Derive a new token instead —
  keep all color decisions in one place.
- **Overriding only half a pair.** `--color-accent` without
  `--color-accent-fg` breaks contrast. Override both or neither.
- **Raw `oklch()` in components.** Only `@theme` blocks should contain
  literals; components reference `var(--color-*)`.
- **Dark mode via `.dark` class.** Framework uses `[data-theme='dark']`.
  The class path interferes with SSR injection.

## References

- ADR-0005 — Tailwind 4 + Vite plugin.
- ADR-0006 — oklch-only decision + browser floor.
- ADR-0046 — three-tier theming (framework / app / tenant).
- ADR-0047 — per-interface presets (no color override).
- ADR-0048 — cookie-backed dark mode.
- ADR-0050 — tenant-theming minimal skeleton.
- oklch docs: <https://oklch.com> (includes a picker + conversion tool).
- Tailwind 4 `@theme` docs: <https://tailwindcss.com/docs/theme>.
