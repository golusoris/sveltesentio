# ADR-0005: Tailwind 4 + `@tailwindcss/vite`

- **Status**: Proposed
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D21 in `.workingdir/research/decisions-needed.md`

## Context

3/4 downstream apps (subdo, revenge, Lurkarr) already ship Tailwind 4 via `@tailwindcss/vite` with the `@theme` directive and no `tailwind.config.ts`. arca is the last holdout. Shipping `@sveltesentio/ui` against Tailwind 3 would force 3 apps to downgrade; shipping against 4 only costs arca a bump.

## Decision

Adopt Tailwind `^4.0.0` (currently `^4.2.1+` in consumer apps) via `@tailwindcss/vite` as the styling floor. Use `@theme` directive for tokens, no `tailwind.config.ts`. Framework peerDep: `"tailwindcss": "^4"`.

## Alternatives considered

- **Tailwind 3** — would force 3/4 apps to downgrade; v3 lacks native `@theme` + oklch-first pipeline.
- **UnoCSS** — no adopter app uses it; loses Tailwind-variants + shadcn-svelte compatibility.
- **Stick with PostCSS + `tailwindcss` plugin** — v4's vite plugin is the documented fast path + better watch story.

## Consequences

**Positive**:
- Zero-config theming via `@theme` + oklch tokens.
- Native Tailwind 4 container queries unlock responsive recipes (see D112 carousel + D120 charts).
- Vite plugin rebuilds are fast; no PostCSS config to maintain.

**Negative / trade-offs**:
- arca migrates from whatever it ships today to v4.
- Any library in `@sveltesentio/*` using `@apply` with v3-only utilities needs audit.

**Documentation obligations**:
- `docs/compose/theming.md` — `@theme` token conventions, oklch channels, dark-mode variant.
- Migration note for any v3-based consumer.

## Evidence

- `.workingdir/research/deepread-subdo.md:21,39` — `@tailwindcss/vite@4.2.2` + no `tailwind.config.ts`.
- `.workingdir/research/deepread-revenge.md:20,33-38` — `tailwindcss@^4.0.0`, `@tailwindcss/vite@^4.0.0`, v4 `@theme` syntax in app.css.
- `.workingdir/research/deepread-lurkarr.md:13-14,35-39,54-62` — `tailwindcss@^4.2.1`, `@tailwindcss/vite@^4.2.1`, v4 `@import 'tailwindcss'` + `@theme` + oklch.
- `.workingdir/research/decisions-needed.md:218` — convergence row: 3/4 apps on Tailwind 4 + `@tailwindcss/vite`.
- `.workingdir/research/decisions-needed.md:293` — user closure.
