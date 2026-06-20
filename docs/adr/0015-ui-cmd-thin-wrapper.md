# ADR-0015: Keep thin `@sveltesentio/ui/cmd` wrapper (shadcn Command + registry + tinykeys)

- **Status**: Accepted
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D169 in `.workingdir/research/decisions-needed.md`

## Context

Command-palette usage splits: Lurkarr's `CommandPalette.svelte:1-83` composes shadcn Command + manual ⌘K handler cleanly in 83 lines; arca uses `tinykeys` for shortcuts (separate concern — keyboard shortcuts, not a command registry); subdo + revenge ship no palette. The initial streamlining verdict recommended downgrading to `docs/compose/`. The user overrode that call, citing consistent command-palette DX across apps as a cross-cutting invariant worth a small wrapper.

## Decision

Keep `@sveltesentio/ui/cmd` as a **thin** wrapper (overrides initial streamlining recommendation). Ships: re-export of shadcn Command primitive + an app-level command registry pattern + `tinykeys` shortcut composer + a11y-defaulted search. arca's `tinykeys` usage folds in. This pre-commits to consistent ⌘K / Ctrl+K DX across future apps.

## Alternatives considered

- **Downgrade to `docs/compose/command-palette.md`** — would re-litigate the registry + shortcut shape per app; initial recommendation based on Lurkarr only.
- **`cmdk-sv`** — shadcn Command already delivers the primitive; no reason to add a second source.
- **Custom palette on bits-ui direct** — loses shadcn's Tailwind + a11y markup.

## Consequences

**Positive**:

- Consistent ⌘K DX across future sveltesentio apps.
- arca's `tinykeys` shortcut pattern folds into the wrapper rather than fighting it.
- A11y-defaulted search + focus handling baked in.

**Negative / trade-offs**:

- Evidence is thin (1 adopter + 1 adjacent user); wrapper risks over-fitting to Lurkarr's static item list.
- Registry API is ours to maintain.

**Documentation obligations**:

- `docs/compose/command-palette.md` — registry authoring, shortcut composer, auth-gated items (Lurkarr pattern), dynamic vs static registries.
- `@sveltesentio/ui/cmd` AGENTS.md — pinned matrix (shadcn Command × tinykeys).

## Evidence

- `.workingdir/research/deepread-lurkarr.md:137-147,316,321` — `CommandPalette.svelte:1-83`, shadcn Command + manual ⌘K, auth-gated items; initial "Downgrade to docs/compose" verdict.
- `.workingdir/research/deepread-arca.md:25,84` — arca uses `tinykeys` for shortcuts (not a command registry).
- `.workingdir/research/decisions-needed.md:249` — initial streamlining verdict: "Downgrade to docs/compose/ ... No cross-cutting invariant".
- `.workingdir/research/decisions-needed.md:315` — user closure overriding streamlining: "Keep thin `@sveltesentio/ui/cmd` wrapper ... User wants consistent command-palette DX across apps".
