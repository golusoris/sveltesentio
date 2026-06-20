# ADR-0049: System-font default + Fontsource variable-font opt-in presets

- **Status**: Accepted
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D166 in `.workingdir/research/decisions-needed.md`

## Context

Typography defaults trade off between:

- **System fonts** — zero download, fast LCP, platform-consistent.
- **Web fonts** — brand consistency, wider weight/style range, LCP penalty.

Most sveltesentio surfaces are interior-facing (dashboards, admin, authenticated flows) where system fonts are acceptable. Marketing + brand-heavy surfaces want Inter / Geist / similar. Forcing a web font by default pays the LCP cost for every consumer.

## Decision

- **Default**: system-font stack — `ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`. Mono default: `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`.
- **Opt-in presets**: `@sveltesentio/ui/font-preset-inter`, `@sveltesentio/ui/font-preset-geist`, `@sveltesentio/ui/font-preset-mono` — each imports a Fontsource variable font (`@fontsource-variable/<name>`), declares `@font-face` with `font-display: swap`, and exports the CSS `font-family` stack.
- Consumers import one preset or author their own; no framework-forced download.

Presets ship with LCP guidance in `docs/performance/fonts.md` (preload `<link rel="preload">` hints for above-fold text; `font-display: swap` to guarantee text paints before font loads).

## Alternatives considered

- **Default Inter** — forces ~40-70 KB download on every consumer; hurts LCP budget (CLAUDE.md §2.9 sets <2.5s).
- **No presets; consumers roll their own** — every app re-does the same Fontsource + preload dance.
- **Google Fonts CDN default** — third-party privacy concern (GDPR); self-host via Fontsource instead.

## Consequences

**Positive**:

- Default bundle adds zero font weight.
- Opt-in presets provide the typical brand fonts with correct loading semantics.
- Self-hosted via Fontsource — no third-party DNS.

**Negative / trade-offs**:

- Brand-heavy consumers must opt in; two-line import vs single default.
- Variable fonts are a kilobyte range bigger than single-weight hosted fonts; documented in LCP guidance.

**Documentation obligations**:

- `docs/performance/fonts.md` — LCP budget, preload hints, font-display strategies.
- `@sveltesentio/ui/font-preset-*` AGENTS.md (one per preset) — subset + preload recipe.

## Evidence

- `.workingdir/research/ecosystem-pass-1-summary.md:112` — D166 pick.
- CLAUDE.md §2.9 — LCP < 2.5s budget.
- Fontsource project — MIT, self-hosted variable fonts.
