# ADR-0030: `mode-watcher@^1.1.0` pin (runes-native) — supersedes `mode-watcher@0.5`

- **Status**: Accepted
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: mode-watcher entry in `.workingdir/research/ecosystem-pass-1-summary.md`

## Context

`mode-watcher` (Huntabyte) handles dark-mode switching for SvelteKit. revenge ships a stale `mode-watcher@0.5.x` (pre-runes, pre-Svelte-5). Lurkarr pins `mode-watcher@1.x`. The v1 line is runes-native and declares `svelte ^5.27.0` peerDep — aligns with our Svelte 5 floor.

`packages/ui/package.json:24` currently carries peerDep `"mode-watcher": ">=0.5.0"` — too loose; permits the stale 0.5 line.

## Decision

Tighten `packages/ui/package.json:24` peerDep to `"mode-watcher": ">=1.1.0 <2"`. `@sveltesentio/ui` (and `@sveltesentio/shell` where it owns layout-level theme state) re-export `mode-watcher` via `ui/theme` + `ui/preset-*` theme hooks. Downstream apps on 0.5 must upgrade before consuming `@sveltesentio/ui`.

## Alternatives considered

- **Keep `>=0.5.0` permissive floor** — permits a pre-runes line incompatible with Svelte 5; effectively broken.
- **`skeleton`-style custom theme switcher** — reinvents what mode-watcher already does well; no scale advantage.
- **Wait for `mode-watcher@2`** — v1 is runes-native and healthy; no reason to defer.

## Consequences

**Positive**:

- Single, runes-native source of truth for theme switching.
- Cookie-backed persistence (ADR-0048) composes with mode-watcher's API.
- revenge's 0.5 pin surfaces as an explicit migration, not a silent incompatibility.

**Negative / trade-offs**:

- revenge carries a one-time migration task (bump + API shift).
- Tied to Huntabyte's cadence; major bumps gated via ADR amendment.

**Documentation obligations**:

- Downstream migration note: revenge 0.5 → 1.1+.
- `@sveltesentio/ui` AGENTS.md — peerDep range + mode-watcher API.

## Evidence

- `.workingdir/research/ecosystem-pass-1-summary.md:67` — pin target.
- `.workingdir/research/deepread-lurkarr.md` — Lurkarr on `mode-watcher@1`.
- `.workingdir/research/deepread-revenge.md` — revenge on stale 0.5.
- `packages/ui/package.json:24` — current loose peerDep.
