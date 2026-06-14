# ADR-0006: oklch-only color tokens, no HSL fallback

- **Status**: Proposed
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D22 in `.workingdir/research/decisions-needed.md`

## Context

Color-science-aware tokens (uniform perceptual lightness, better gamut handling) materially improve theming and contrast predictability. Safari shipped `oklch()` in 15.4, and global support is now >99% of evergreen targets. Shipping both oklch and HSL fallbacks would double token counts and force every theme consumer to maintain a dual table. The 2/2 downstream apps with explicit v4 token tables (revenge + Lurkarr) already ship oklch-only.

## Decision

Define all `@sveltesentio/ui` color tokens as `oklch(L C H)` inside `@theme` with **no HSL fallback**. Browser floor: Safari ≥15.4 / Chrome 111+ / Firefox 113+.

## Alternatives considered

- **oklch + HSL fallback** — doubles token surface, doubles theme-switcher cost, no meaningful user won given >99% modern coverage.
- **HSL-only** — loses perceptual uniformity + larger accessible gamut; regresses from what revenge/Lurkarr already ship.
- **RGB hex** — even worse for perceptual contrast reasoning than HSL.

## Consequences

**Positive**:
- Matches revenge + Lurkarr today; one token syntax framework-wide.
- Uniform perceptual lightness simplifies WCAG contrast reasoning.
- Wider P3 gamut available where the display supports it.

**Negative / trade-offs**:
- Pre-15.4 Safari, pre-111 Chrome, pre-113 Firefox are unsupported. Kiosk/embedded webviews shipped with older Chromium need an explicit browser-matrix check before deployment.
- Brand-color tooling that only emits hex requires an oklch conversion step.

**Documentation obligations**:
- `docs/compose/theming.md` — oklch token authoring, WCAG contrast ratios per token.
- `@sveltesentio/ui` AGENTS.md — browser floor banner.

## Evidence

- `.workingdir/research/deepread-revenge.md:33-38` — `--color-accent: oklch(0.7 0.15 250)`, module-specific oklch accents.
- `.workingdir/research/deepread-lurkarr.md:54-62` — "OKLCH color space (no HSL fallback) — Safari ≥15.4 safe".
- `.workingdir/research/decisions-needed.md:219` — convergence row: "oklch-only colors" (2/2 v4 apps).
- `.workingdir/research/decisions-needed.md:294` — user closure: "Safari ≥15.4 native support (>99% of target)".
