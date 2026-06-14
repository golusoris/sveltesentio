# ADR-0046: Three-tier theming — compile-time `@theme` + runtime cookie + user-customiser

- **Status**: Proposed
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D160 + D163 in `.workingdir/research/decisions-needed.md`

## Context

Theming decomposes into three axes that usually get conflated:

1. **Design tokens** — colour palette, spacing, typography baseline. Slow-changing; compile-time.
2. **Mode switching** — light/dark (+ optional high-contrast, reduced-motion). Per-visit; runtime, cookie-persisted.
3. **End-user customisation** — user tweaks accent colour, density. Per-user; persisted server-side.

Rolling all three into one system couples a palette rewrite to a mode toggle. Keeping them split lets each evolve independently.

## Decision

Three tiers, each owned by a different surface:

- **Tier 1 — compile-time `@theme`**: Tailwind 4 `@theme` block defines tokens (oklch palette per ADR-0006). Lives in `@sveltesentio/ui/preset` CSS. Changes require rebuild.
- **Tier 2 — runtime mode**: `mode-watcher@^1.1` (ADR-0030) flips `<html class="dark">` based on cookie / `prefers-color-scheme`. Server-injected for zero flash (ADR-0048).
- **Tier 3 — user customiser**: optional `@sveltesentio/ui/theme-customizer` component. Writes per-user overrides (e.g. `--accent: <oklch>`) to a user-preferences API. Consumers provide the persistence endpoint.

Default header + settings-page surfaces: toggle lives in a header icon-button (optional; opt-out prop); settings-page section renders all three tiers (mode toggle + customiser when enabled). Palette entry is app-level opt-in.

## Alternatives considered

- **Single runtime theming system** — recomputes tokens at runtime; slower paint, larger JS payload.
- **Compile-time only** — cannot do user customisation without a rebuild.
- **CSS-in-JS** — runtime cost + hydration mismatch risk; rejected in ADR-0005 posture.

## Consequences

**Positive**:
- Each tier evolves independently; palette rewrite doesn't touch the mode toggle.
- Server-injected mode class eliminates flash-of-wrong-theme.
- User customiser optional; frameworks without user-prefs storage skip tier 3.

**Negative / trade-offs**:
- Three-tier documentation overhead; consumers need to know which tier a change belongs to.
- Tier 3 requires a consumer-provided persistence endpoint; no default.

**Documentation obligations**:
- `docs/compose/theming.md` — three-tier map with per-tier recipes.
- `@sveltesentio/ui/preset` AGENTS.md — `@theme` authoring.
- `@sveltesentio/ui/theme-customizer` AGENTS.md — consumer persistence contract.

## Evidence

- `.workingdir/research/ecosystem-pass-1-summary.md:107,110` — D160 + D163 picks.
- ADR-0006 — oklch palette foundation.
- ADR-0030 — mode-watcher pin.
