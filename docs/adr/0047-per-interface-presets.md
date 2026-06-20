# ADR-0047: Per-interface presets — `ui/preset-{desktop,10foot,handheld,dashboard}`

- **Status**: Accepted
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D161 in `.workingdir/research/decisions-needed.md`

## Context

`docs/ux-principles.md` enumerates distinct interface paradigms (desktop productivity, 10-foot TV, handheld mobile, dashboard-heavy, doc-centric, spatial-graph). Each paradigm has a different base grid, typography scale, touch-target floor, and density norm. Shipping one `@sveltesentio/ui/preset` that tries to serve all of them creates runtime branching or monstrous token sets. Splitting presets per paradigm keeps each focused.

This formalises the direction already proposed by ADR-0016 (preset-aware sizing in `ui/toast`). "Preset theming invariant" feedback memory: wrappers justified when a concern scales with interface-type preset.

## Decision

`@sveltesentio/ui/preset-*` splits into per-interface packages, each a Tailwind 4 `@layer base` + `@theme` set:

- `ui/preset-desktop` — density-normal, 8pt grid, 14-16px base, `44px` min-target except dense toolbars.
- `ui/preset-10foot` — density-loose, 16pt grid, 24-32px base, `64px` min-target, high-contrast defaults, focus-ring 4px (D-pad visibility). Paired with `focus-graph` router (ADR-0027).
- `ui/preset-handheld` — density-normal, 8pt grid, 16-18px base, `48px` min-target, safe-area baked in (ADR-0029).
- `ui/preset-dashboard` — density-compact, 4pt grid, 12-14px base, charts-first layout helpers.

Apps import one preset (or compose a custom one from primitives). `shell`'s device-detection feeds the default choice at SSR.

## Alternatives considered

- **Single preset with media queries** — responsive type scale works for desktop↔handheld but breaks for 10-foot (sitting distance, not screen size, drives scale).
- **Runtime branching on interface type** — harder to reason about; doubles bundle.
- **Per-app custom presets** — every app re-specifies the same 4 paradigms.

## Consequences

**Positive**:

- Each paradigm has honest defaults; density + min-target + grid aligned without compromise.
- Apps pick one; no runtime guessing.
- Preset-aware wrappers (`ui/toast`, `ui/cmd`) have a stable API to target.

**Negative / trade-offs**:

- Four presets to maintain; each has its own axe-contrast lane.
- Custom preset (fifth paradigm) requires consumers to author their own — by design.

**Documentation obligations**:

- `docs/compose/preset-choice.md` — how to pick a preset per app.
- `@sveltesentio/ui/preset-*` AGENTS.md (one per preset) — token values + rationale.

## Evidence

- `.workingdir/research/ecosystem-pass-1-summary.md:108` — D161 pick.
- `docs/ux-principles.md` — paradigms.
- ADR-0016 — preset-aware toast sizing (first consumer).
- Memory: `feedback_preset_theming_invariant.md`.
