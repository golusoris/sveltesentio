# ADR-0025: `bits-ui` Command primitive supersedes `cmdk-sv`; `tinykeys` bundled in `ui/cmd`

- **Status**: Accepted
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D27 in `.workingdir/research/decisions-needed.md`

## Context

`cmdk-sv@0.0.19` (the former Svelte port of `cmdk`) is unmaintained and pre-Svelte-5. `bits-ui@2` now ships a first-class `Command` primitive with Svelte 5 runes support, matching shadcn-svelte's delivery format. `ui/cmd` (ADR-0015) already keeps a thin wrapper; this ADR pins the primitive it wraps.

## Decision

- Delete `cmdk-sv` from any remaining reference (awesome-harvest.md:61 entry to be pruned).
- Pin `bits-ui@^2.16.3` for the Command primitive inside `@sveltesentio/ui/cmd`.
- Bundle `tinykeys@^3.0.0` as the shortcut composer inside the same wrapper (folds arca's usage pattern).
- Expose a small registry API so consumers register commands without re-implementing the DX per app.

## Alternatives considered

- **Stay on `cmdk-sv`** — stale, no Svelte 5 support.
- **Hand-roll on bits-ui primitives only** — re-implements the Command registry + keymap shape per consumer.
- **Ship a custom palette on raw DOM** — loses shadcn markup + a11y defaults.

## Consequences

**Positive**:

- Command primitive stays in lockstep with the rest of shadcn-svelte's upgrade cadence.
- `tinykeys` covers global shortcut registration without pulling in a second keybinder.
- arca's existing `tinykeys` install consolidates into the wrapper.

**Negative / trade-offs**:

- Consumers previously on `cmdk-sv` migrate imports.
- bits-ui major bumps ripple into `ui/cmd`; pinned via ADR amendment.

**Documentation obligations**:

- `docs/compose/command-palette.md` — registry authoring, shortcut composer, auth-gated items.
- `awesome-harvest.md:61` pruned (drop `cmdk-sv` row).
- Migration note in downstream apps using `cmdk-sv` directly.

## Evidence

- `.workingdir/research/ecosystem-pass-1-summary.md:62` — D27 pick.
- `.workingdir/research/ecosystem-batch-b.md` — bits-ui Command maturity + `cmdk-sv` deprecation.
- `.workingdir/research/deepread-arca.md` — `tinykeys` usage.
