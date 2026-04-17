# sveltesentio — §3 UI/UX Design Principles

The design contract for every `@sveltesentio/ui` preset and every app built on the framework.
Interface type determines design paradigm. Color is always oklch. Spacing is always 8pt grid.

---

## §3.1 Color system — oklch only

All colors are defined exclusively in `oklch(L C H)`. No hex, no rgb, no hsl anywhere in the
framework. Tailwind CSS 4 uses oklch internally — this aligns perfectly.

### Why oklch

- **Perceptually uniform**: L (lightness) 0–100 maps linearly to human perception
- **Full P3 gamut**: expresses colors hex/rgb cannot (vivid blues, greens on modern displays)
- **Predictable manipulation**: darken by subtracting L; shift hue by rotating H; same C keeps vibrancy
- **Accessible by construction**: contrast ratios are predictable — design to WCAG by adjusting L
- **Tailwind 4 native**: the engine already works in oklch; CSS custom properties match directly

### Color token structure

```css
/* Primitive layer — direct oklch values, never used directly in components */
--primitive-blue-50:  oklch(97% 0.02 250);
--primitive-blue-500: oklch(55% 0.18 250);
--primitive-blue-900: oklch(25% 0.09 250);

/* Semantic layer — maps to primitives, used in components */
--color-primary:        var(--primitive-blue-500);
--color-primary-hover:  oklch(from var(--color-primary) calc(l - 0.07) c h);
--color-primary-active: oklch(from var(--color-primary) calc(l - 0.14) c h);

/* Status colors — colorblind-safe (never rely on hue alone; pair with icon/shape) */
--color-critical: oklch(55% 0.22 25);   /* red — also use ⚠ icon */
--color-warning:  oklch(70% 0.18 70);   /* amber — also use ! icon */
--color-ok:       oklch(65% 0.18 145);  /* green — also use ✓ icon */
--color-info:     oklch(60% 0.15 245);  /* blue — also use ℹ icon */

/* Surface tokens */
--surface:          oklch(13% 0.01 250);  /* near-black for dark mode */
--surface-elevated: oklch(18% 0.01 250);
--surface-overlay:  oklch(23% 0.01 250);

/* Text tokens — opacity-based on same hue as surface */
--text-primary:   oklch(95% 0.005 250);  /* 87% visual weight */
--text-secondary: oklch(72% 0.005 250);  /* 60% visual weight */
--text-tertiary:  oklch(55% 0.005 250);  /* 38% visual weight */
```

### Hue palette — core hues used across all presets

| Name | Hue (H) | Usage |
|---|---|---|
| Blue | 250 | Primary action, links, info |
| Purple | 295 | Auth, premium features |
| Teal | 195 | Secondary action, realtime indicators |
| Amber | 70 | Warning, caution |
| Red | 25 | Critical, destructive, error |
| Green | 145 | Success, ok, active |
| Gray | 250 (low C) | Neutral surfaces, text |

### Interface-type hue overrides

Each preset overrides `--color-primary` hue while keeping the L/C structure:

- **Media** preset: `H=295` (purple — cinematic, premium)
- **Dashboard** preset: `H=195` (teal — data, monitoring)
- **Webapp** preset: `H=250` (blue — neutral, universal)
- **Flow editor** preset: `H=250` (blue — technical)
- **PWA** preset: `H=250` (blue — system-native feel)
- **10-foot** preset: `H=295` (purple — TV/entertainment)

### Color manipulation patterns

```css
/* Darken: subtract L */
--btn-hover: oklch(from var(--color-primary) calc(l - 0.07) c h);

/* Lighten: add L */
--badge-bg: oklch(from var(--color-primary) calc(l + 0.40) calc(c * 0.3) h);

/* Shift hue: rotate H */
--secondary: oklch(from var(--color-primary) l c calc(h + 60));

/* Desaturate: reduce C */
--disabled: oklch(from var(--color-primary) l calc(c * 0.2) h);

/* Transparency via alpha */
--overlay: oklch(0% 0 0 / 50%);
```

---

## §3.2 Spacing — 8pt grid

All spacing values are multiples of 4px (half-grid) or 8px (full grid). No arbitrary values.

```css
--space-1:  4px;   /* 0.5 grid — use sparingly, for tight internal spacing */
--space-2:  8px;   /* 1 grid — icon gap, small internal padding */
--space-3:  12px;  /* 1.5 grid */
--space-4:  16px;  /* 2 grid — standard padding, form field gap */
--space-6:  24px;  /* 3 grid — card padding, section gap */
--space-8:  32px;  /* 4 grid — large section gap */
--space-12: 48px;  /* 6 grid — page section separation */
--space-16: 64px;  /* 8 grid — hero spacing */
--space-24: 96px;  /* 12 grid — large layout margin */
```

Tailwind 4 maps: `p-2` = 8px, `p-4` = 16px, `p-6` = 24px etc. — use these, not arbitrary values.

---

## §3.3 Typography system

### Type scale (modular, ratio 1.25)

```css
--text-2xs: 11px;  /* captions, badges, timestamps */
--text-xs:  12px;  /* secondary metadata */
--text-sm:  13px;  /* compact UI (dashboard density) */
--text-base: 16px; /* body — standard web */
--text-lg:  18px;  /* subheadings */
--text-xl:  20px;  /* section headings */
--text-2xl: 24px;  /* page headings */
--text-3xl: 30px;  /* hero headings */
--text-4xl: 36px;  /* display */
--text-5xl: 48px;  /* 10-foot UI minimum title */
```

### Font families

```css
--font-sans: 'Inter Variable', ui-sans-serif, system-ui, sans-serif;
--font-mono: 'JetBrains Mono Variable', 'Fira Code', ui-monospace, monospace;
--font-display: var(--font-sans); /* use display-optimized weight on headings */
```

Rules:
- Variable fonts only (no static weight files)
- Monospace for: numbers in tables/metrics, code, timestamps, file sizes
- `font-feature-settings: 'tnum' 1` on numeric data for tabular alignment
- Minimum 16px for body text; 13px only in high-density UIs with adequate whitespace
- Line height: 1.5 for body, 1.25 for headings, 1.4 for compact UI

---

## §3.4 Interface-type design rules

### 10-foot UI / Media Center

**Viewing context**: 2–4 metre viewing distance, remote/gamepad navigation, ambient lighting.

Layout:
- TV-safe insets: minimum 5% (≈60px on 1080p) from all edges
- 5–7 cards per row maximum — horizontal carousels as primary browse pattern
- No small text; minimum 29pt at distance ≈ 16px × 1.8 scaling factor
- Dark background `oklch(8% 0.01 295)` — deep purple-black, not pure black (reduces eye strain)

Focus system:
- Focus state: `scale(1.08)` + `box-shadow: 0 0 0 4px var(--color-primary)` + `brightness(1.15)`
- Focus MUST be unmistakable at distance — never subtle outline only
- D-pad spatial logic: arrow key always moves to nearest element in that direction
- No focus traps except in modals (which should be rare on 10-foot UIs)
- `tabindex` must follow visual spatial order

Interaction:
- No text input where avoidable — use search suggestions + D-pad select
- Confirm actions with single large button — no tiny secondary links
- Back button is always prominent (hardware back / B button / Escape)

Colors (10-foot preset):
- Primary hue: `H=295` (cinematic purple)
- Background: `oklch(8% 0.01 295)`
- Card: `oklch(14% 0.015 295)`
- Text primary: `oklch(95% 0.005 295)`
- Accent (selected): `oklch(65% 0.22 295)`

### Media Server Web UI

**Context**: desktop browser, media-centric, long sessions.

Layout:
- Artwork grid dominates — text is metadata, not primary content
- Left sidebar: library navigation (280px wide, collapsible to 56px icon rail)
- Fixed playback bar at bottom: `height: 72px`, never overlaps main scroll
- Cards: 180×240px (portrait), 240×135px (landscape/16:9)
- Hover reveals quick actions: play overlay, queue button, favorite toggle

Images:
- Always `loading="lazy"` + `decoding="async"`
- Dominant color placeholder while loading (extract via `color-thief` or CSS `background-color`)
- WebP/AVIF required; JPEG fallback only
- `aspect-ratio: 2/3` (portrait) or `aspect-ratio: 16/9` (landscape) — no layout shift

Colors (media preset):
- Background: `oklch(10% 0.01 295)` (deep cinematic)
- Surface: `oklch(14% 0.015 295)`
- Surface elevated: `oklch(19% 0.015 295)`
- Primary: `oklch(65% 0.22 295)` (vivid purple accent)
- Now-playing indicator: `oklch(72% 0.20 145)` (green)

### Dashboard / Admin UI

**Context**: monitoring, data-dense, power users, long sessions.

Layout:
- 8pt spacing grid strictly — no loose padding
- Body text: 13–14px (density) with 1.4 line height
- Monospace for all numbers, metrics, percentages, timestamps
- Sidebar: 240px (expanded), 56px (icon rail collapsed)
- Content: 12-column CSS grid, cards snap to grid

Realtime:
- SSE for live data — never polling (no visible refresh flicker)
- New data animates in — `@keyframes fade-slide-in` (150ms)
- Alert banners animate from top — never modal overlays
- Connection status always visible (small dot in corner)

Semantic colors (dashboard):
- Critical: `oklch(55% 0.22 25)` + triangle warning icon
- Warning: `oklch(70% 0.18 70)` + exclamation icon
- Ok: `oklch(65% 0.18 145)` + check icon
- Info: `oklch(60% 0.15 245)` + info icon
- Rule: NEVER rely on color alone — always pair with icon and text label

### Automation / Flow Editor

**Context**: canvas-based visual programming, technical users.

Canvas:
- Background: `oklch(10% 0.005 250)` dark grid, no pure black
- Grid: `oklch(16% 0.005 250)` dots at 16px intervals, snap-to-grid
- Node min-width: 180px, min-height: 60px (readable text at zoom-out)
- Edge stroke: 2px, `oklch(50% 0.05 250)` default, `oklch(65% 0.22 295)` selected

Node color semantics:
- Input/Source: `oklch(55% 0.18 245)` (blue border)
- Transform/Process: `oklch(55% 0.18 295)` (purple border)
- Output/Sink: `oklch(60% 0.18 145)` (green border)
- Error/Invalid: `oklch(55% 0.22 25)` (red border)
- Selected: 3px `oklch(75% 0.20 70)` (amber highlight)

### File Manager / Library Browser

**Context**: mass operations, thousands of items, keyboard-heavy.

Layout:
- Virtual scroll is mandatory — no pagination for primary views
- Grid: `minmax(160px, 1fr)` responsive columns with 8px gap
- List: table with `table-layout: fixed`, sortable column headers
- Toolbar: fixed top, 48px height — view toggle, sort, filter, search, bulk actions
- Status bar: fixed bottom, 36px height — item count, selection count

Multi-select:
- Click = single select (deselects others)
- Ctrl/Cmd+Click = toggle in selection
- Shift+Click = range select
- Drag rectangle = area select
- Keyboard: arrow keys navigate, Space = toggle select, Enter = open

Colors (file manager):
- Selected item: `oklch(55% 0.15 250 / 20%)` background tint
- Selected item border: `oklch(60% 0.20 250)`
- Hover: `oklch(50% 0.005 250 / 10%)` background tint
- Folder icons: `oklch(70% 0.18 70)` (amber)

### Standard Web App (SaaS / CRUD)

**Context**: forms, auth flows, standard navigation patterns.

Layout:
- Max content width: 1280px centered
- Top navbar: 64px height, sticky
- Sidebar (if present): 256px, sticky, scrollable
- Forms: max-width 640px, centered in content area
- Modals: max-width 480px (small), 640px (medium), 80vw (large)

Form UX:
- Validation: client-side (Zod) as-you-blur; server-side on submit
- Errors display below the field in `--color-critical`
- Required fields: `*` suffix on label (not inside field placeholder)
- Success: green check icon appears after valid blur
- Destructive actions: always require confirmation AlertDialog

Colors (webapp preset — light default, dark optional):
- Background: `oklch(99% 0.003 250)` (near white)
- Surface: `oklch(97% 0.005 250)` (slight tint)
- Primary: `oklch(55% 0.18 250)` (blue)
- Text: `oklch(15% 0.01 250)` (near black)

### Mobile PWA

**Context**: touch-first, offline-capable, installable.

Touch:
- Minimum touch target: 48×48px — never smaller
- Spacing between targets: minimum 8px
- Bottom navigation: 56–64px height, safe-area-inset-bottom padding
- Thumb zone: primary actions in bottom 40% of screen

Patterns:
- Bottom sheet (not centered modal) for overlays
- Pull-to-refresh on all list views
- Swipe right = back (mirror iOS native)
- Long-press = context menu (not right-click)
- Bottom tab nav: 4–5 items max (more → "More" tab)

CSS for safe areas:
```css
.bottom-nav {
  padding-bottom: max(16px, env(safe-area-inset-bottom));
}
.top-bar {
  padding-top: max(16px, env(safe-area-inset-top));
}
```

---

## §3.5 Motion and animation

Principles:
- Motion has purpose — it communicates state change, not decoration
- Duration: 100ms (micro), 200ms (standard), 350ms (page transition)
- Easing: `cubic-bezier(0.4, 0, 0.2, 1)` (Material standard) for most
- Never animate `width`/`height` — use `transform: scale()` instead
- Respect `prefers-reduced-motion`: wrap all non-essential animations

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

Standard animations:
- Fade in: `opacity: 0 → 1` (150ms)
- Slide up: `translateY(8px) → translateY(0)` + fade (200ms)
- Scale pop: `scale(0.95) → scale(1)` + fade (150ms)
- Page transition: `translateX(100%) → translateX(0)` (300ms) for route changes

---

## §3.6 Accessibility baseline (all interface types)

- WCAG 2.2 AA minimum — see §2.3 in `docs/principles.md` for full details
- Focus visible: always 2px+ offset outline in `var(--color-primary)` or white
- axe-core: 0 violations on every component
- Keyboard: every interactive element reachable + operable
- Screen reader: semantic HTML first; ARIA roles only when HTML is insufficient
- Color: never sole differentiator — always pair with shape, icon, or text
- Animation: always respect `prefers-reduced-motion`
- Font size: never below 12px on screen; never below 16px (29pt) on 10-foot UI

---

## §3.7 Responsive breakpoints

```css
/* Mobile first */
/* xs: 0–479px — single column, bottom nav */
/* sm: 480–767px — still mobile, larger touch targets */
@media (min-width: 640px)  { /* sm  — Tailwind default */ }
@media (min-width: 768px)  { /* md  — tablet portrait */ }
@media (min-width: 1024px) { /* lg  — tablet landscape, small desktop */ }
@media (min-width: 1280px) { /* xl  — standard desktop */ }
@media (min-width: 1536px) { /* 2xl — wide desktop, 4K */ }

/* TV / 10-foot UI */
@media (min-width: 1920px) and (hover: none) { /* TV remote navigation */ }
```

Container queries for component-level responsiveness:
```css
@container (min-width: 400px) { /* card switches from stacked to inline */ }
```

---

## §3.8 International + RTL support

- All spacing via logical properties: `margin-inline-start` not `margin-left`
- Tailwind: use `ms-*`/`me-*` (not `ml-*`/`mr-*`) for i18n-safe margins
- RTL: `direction: rtl` on `<html>` when `lang` is Arabic, Hebrew, Persian, etc.
- Text alignment: `text-start` not `text-left`
- Icons: mirror horizontally in RTL (back arrows, navigation indicators)
- Numbers: always render LTR even in RTL layouts (`unicode-bidi: embed`)
- Date/number formats: use `Intl.DateTimeFormat` / `Intl.NumberFormat` — never hardcode separators
- Currency: `Intl.NumberFormat(locale, { style: 'currency', currency })` — never format manually

---

## §3.9 Platform / device HIG references

| Platform | Standard | Key rules for sveltesentio |
|---|---|---|
| Web (all) | WCAG 2.2 AA | Minimum baseline; always enforced |
| iOS | Apple HIG | Safe area insets, 44pt min targets, bottom sheet modals |
| Android | Material Design 3 | 48dp min targets, bottom nav, fab placement |
| tvOS | Apple TV HIG | 60pt TV-safe, D-pad nav, `focusable` elements |
| Android TV | Leanback | Same as tvOS principles; min target 96dp |
| Desktop | GNOME HIG / Fluent | Keyboard-first, right-click context, drag-drop, dense |
| Watch | N/A | Not targeted by current interface types |

When building for a specific platform, the interface-type preset + platform HIG rules combine:
- Media server web UI running as iPad PWA → apply media preset + iOS safe areas + touch targets
- Dashboard on Android TV → apply 10-foot preset + Android TV navigation patterns

---

## §3.10 Cross-platform browser compatibility

**Goal: zero native client apps.** Every interface type ships as a web app that works natively
on every platform. Users should never need to install a platform-specific client.

### Browser support matrix

| Browser | Min version | Notes |
|---|---|---|
| Chrome / Chromium | 120+ | Reference implementation; WebGPU available |
| Firefox | 121+ | Full CSS oklch support; WebGPU behind flag |
| Safari / WebKit | 17.2+ | Safe area insets; iOS PWA support |
| Samsung Internet | 23+ | Android PWA install |
| Edge | 120+ | Chromium-based; parity with Chrome |

**No IE, no legacy Edge, no Opera Mini.** Framework requires CSS oklch, CSS nesting,
`@layer`, container queries, `has()` — all baseline in the above matrix.

### Device coverage

| Category | Method | Framework support |
|---|---|---|
| Desktop (1080p+) | Responsive CSS | All presets |
| Laptop (768–1440px) | Responsive CSS | All presets |
| Tablet (landscape) | `md:` Tailwind breakpoint | All presets |
| Tablet (portrait) | `sm:` + touch targets | Standard / PWA presets |
| Phone (360–430px) | `sm:` mobile-first | PWA preset primary |
| 4K / ultrawide | `2xl:` max-width container | Dashboard / media presets |
| TV / 10-foot (1080p+, no hover) | `@media (min-width: 1920px) and (hover: none)` | 10-foot preset |
| Smart TV browser | Chromium-based TV runtimes | 10-foot preset |

### CSS compatibility rules

```css
/* Always provide oklch fallback for Safari < 15.4 (not in matrix, but defensive) */
/* Tailwind 4 handles this automatically via PostCSS */

/* Safe area insets — always use for any full-screen layout */
padding: env(safe-area-inset-top) env(safe-area-inset-right)
         env(safe-area-inset-bottom) env(safe-area-inset-left);

/* Container queries — use over media queries for components */
@container (min-width: 400px) { ... }

/* :has() for parent state — available in all supported browsers */
.card:has(input:checked) { ... }
```

### Progressive enhancement tiers

| Feature | Baseline | Enhanced |
|---|---|---|
| Images | `<img>` with alt | `loading="lazy"` + `decoding="async"` + AVIF/WebP |
| Video | `<video>` + HLS fallback | vidstack + native MSE |
| Offline | Network-first | Service worker + cache-first via `@vite-pwa/sveltekit` |
| AI | Server-side inference | Edge AI via Transformers.js + WebGPU (Chrome 120+) |
| Animations | CSS transitions | GSAP/Web Animations API, respects `prefers-reduced-motion` |
| Push notifications | None | `Notification API` + Service Worker (PWA only) |

### PWA installability checklist

Every app using the PWA preset must pass:

- [ ] `manifest.json` with `display: standalone`, icons at 192×192 and 512×512
- [ ] Service worker registered via `@vite-pwa/sveltekit`
- [ ] HTTPS (required by browsers)
- [ ] `<meta name="theme-color">` set to `--color-primary` oklch value as hex fallback
- [ ] `safe-area-inset-*` applied to all full-screen layouts
- [ ] Lighthouse PWA score ≥ 90

### Testing cross-platform

- BrowserStack / Playwright device emulation for tablet/phone coverage
- Real device testing on iOS Safari and Android Chrome before each release
- `@playwright/test` runs against Chromium, Firefox, WebKit in CI (`ci.yml`)
- `axe-core` accessibility checks on all three engines
- Lighthouse CI thresholds in `ci.yml`: performance ≥ 80, accessibility ≥ 95, best-practices ≥ 90

---

## §3.11 Design token implementation

Tokens live in `@sveltesentio/ui/tokens`. Each interface-type preset imports the base tokens
and overrides only what differs.

```typescript
// packages/ui/src/tokens/base.css
// packages/ui/src/tokens/media.css      (extends base)
// packages/ui/src/tokens/dashboard.css  (extends base)
// packages/ui/src/tokens/webapp.css     (extends base, light default)
// packages/ui/src/tokens/pwa.css        (extends base, system-preference)
// packages/ui/src/tokens/ten-foot.css   (extends media, enlarged type/spacing)
// packages/ui/src/tokens/flow.css       (extends base, canvas-specific)
```

Usage in an app:
```svelte
<!-- app/src/app.html -->
<link rel="stylesheet" href="/node_modules/@sveltesentio/ui/tokens/media.css" />
```

Or via Tailwind 4 CSS import:
```css
/* app/src/app.css */
@import '@sveltesentio/ui/tokens/media.css';
@import 'tailwindcss';
```
