# ADR-0012: `embla-carousel-svelte` via shadcn-svelte CLI; `docs/compose/carousel.md` for reduced-motion + target-size

- **Status**: Proposed
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D112 in `.workingdir/research/decisions-needed.md`

## Context

revenge ships `embla-carousel-svelte@^8.6.0` direct; arca, subdo, Lurkarr ship no carousel. Full re-audit (`reaudit-d112-carousel.md`) against shadcn-svelte inventory + live upstream docs shows shadcn-svelte ships a `Carousel` component that wraps embla verbatim, Swiper dropped Svelte v9, @splidejs/svelte-splide has no releases, keen-slider has no Svelte 5 story and zero a11y docs. Embla v8.6.0 has **no built-in a11y** — the shadcn wrapper compensates with `role="region"` / `aria-roledescription="carousel"` + keyboard handlers + sr-only text.

## Decision

Adopt `embla-carousel-svelte@^8.6.0` installed via `pnpm dlx shadcn-svelte@latest add carousel`. No `@sveltesentio/ui/carousel` wrapper — follow the shadcn CLI delivery path. Ship `docs/compose/carousel.md` documenting three consumer obligations the shadcn wrapper does not automate: (a) `breakpoints: { '(prefers-reduced-motion: reduce)': { duration: 0 } }`, (b) override shadcn's default `size="icon-sm"` (28px) to `size="icon"` (32px) or `size="icon-lg"` on touch/TV surfaces for WCAG 2.5.8 enhanced, (c) if SR live-region announcements matter, upgrade to embla v9 + `embla-carousel-accessibility` plugin or ship a custom `aria-live="polite"` region.

## Alternatives considered

- **Swiper** — dropped Svelte components in v9; Element path forces shadow DOM + loses Tailwind reach.
- **@splidejs/svelte-splide** — "No releases published"; no Svelte 5 validation signal.
- **keen-slider** — Svelte missing from official framework list; zero a11y docs; no Svelte 5 binding.
- **svelte-carousel** (community) — stale; no Svelte 5 maintenance signal.
- **Custom `@sveltesentio/ui/carousel` wrapper over embla** — duplicates shadcn-svelte's wrapper; violates streamlining rule.

## Consequences

**Positive**:
- Ships with shadcn-svelte runes example (`let api = $state<CarouselAPI>()`) + Tailwind v4 basis/breakpoint utilities out of the box.
- shadcn wrapper already compensates for v8 a11y gaps (role/aria/keyboard/sr-only).
- Revenge's direct embla pattern migrates cleanly to the shadcn CLI path on next UI pass.

**Negative / trade-offs**:
- Three consumer obligations (reduced-motion, target-size, live-region) must be remembered per use — docs/compose is the enforcement surface, not a wrapper.
- revenge carries a one-time migration from direct embla → shadcn Carousel.

**Documentation obligations**:
- `docs/compose/carousel.md` — reduced-motion breakpoint, `size="icon"` target-size override, optional v9 a11y plugin upgrade recipe, orientation variants, focus-follow with `watchFocus`.

## Evidence

- `.workingdir/research/deepread-revenge.md:16,143-168,211` — `embla-carousel-svelte@^8.6.0`, `CastCarousel.svelte:56-87` runes pattern.
- `.workingdir/research/reaudit-d112-carousel.md:7-9` — revenge direct usage; arca grid patterns; subdo + Lurkarr no carousel.
- `.workingdir/research/reaudit-d112-carousel.md:17-32` — shadcn-svelte `Carousel` wraps embla verbatim; peerDep `svelte ^5.0.0`; v8.3.0 `onemblaInit` rename for Svelte 5.
- `.workingdir/research/reaudit-d112-carousel.md:34-44` — Swiper v9 dropped Svelte; splide-svelte "No releases"; keen-slider omits Svelte from framework list.
- `.workingdir/research/reaudit-d112-carousel.md:85-94` — four-axes deep-check confirms lock; three documentation obligations identified.
- `.workingdir/research/decisions-needed.md:228,307` — convergence + user closure row.
