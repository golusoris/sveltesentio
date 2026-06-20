# ADR-0029: Tailwind 4 `@utility` safe-area helpers + `viewport-fit=cover`

- **Status**: Accepted
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D143 in `.workingdir/research/decisions-needed.md`

## Context

Tailwind 4.2.1 does not ship native safe-area utilities. iOS PWA / Android edge-to-edge / TV overscan all require `env(safe-area-inset-*)` honouring padding. Every adopter app currently re-implements these as inline styles or per-app utility classes. Tailwind 4's `@utility` syntax lets us register framework-level helpers once.

## Decision

Ship CSS-only safe-area helpers inside `@sveltesentio/ui/preset` using Tailwind 4 `@utility`:

- `pt-safe-top`, `pb-safe-bottom`, `pl-safe-left`, `pr-safe-right` — padding on the respective inset.
- `pt-safe-top-or-<n>`, etc. — `max(env(safe-area-inset-top), <n>px)` variants.
- Margin + inset equivalents (`mt-safe-top`, `top-safe-top`) for absolute positioning.
- Logical-property variants (`ps-safe-start`, `pe-safe-end`) to compose with RTL.

Plus: `@sveltesentio/shell` injects `<meta name="viewport" content="viewport-fit=cover, ...">` into `app.html` so the insets actually resolve on iOS.

## Alternatives considered

- **`tailwindcss-safe-area` plugin** — Tailwind 3-era plugin; Tailwind 4 moved to `@utility` syntax, plugin ecosystem porting in flux.
- **Per-app `@utility` defs** — every app reimplements; drift over time.
- **Inline `paddingTop: 'env(...)'`** — loses Tailwind's responsive + state variants.

## Consequences

**Positive**:

- One import (`@sveltesentio/ui/preset`) unlocks safe-area-aware layouts across iOS PWA, Android edge-to-edge, TV.
- Logical-property variants cooperate with ADR-0040 RTL posture.
- No runtime cost (CSS-only).

**Negative / trade-offs**:

- Consumers must load the preset CSS once (standard Tailwind preset pattern).
- Tailwind 4 `@utility` syntax is new; locked via ADR-0005.

**Documentation obligations**:

- `docs/compose/safe-area.md` — when to use which variant; meta tag requirement.
- `@sveltesentio/ui/preset` AGENTS.md — utility list + Tailwind 4 gotchas.

## Evidence

- `.workingdir/research/ecosystem-pass-1-summary.md:66` — D143 pick.
- `.workingdir/research/ecosystem-batch-b.md` — Tailwind 4.2.1 native-utility check (no safe-area).
- MDN `env(safe-area-inset-*)` reference.
