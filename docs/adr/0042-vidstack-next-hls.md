# ADR-0042: Vidstack `@next` (1.12.13) + `hls.js@^1.6` for media player

- **Status**: Accepted
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D110 + D111 in `.workingdir/research/decisions-needed.md`

## Context

revenge ships Vidstack for its video UI. Critical gotcha: **npm `vidstack@latest` points to the legacy 0.6.15 line; the modern Svelte 5-compatible build is distributed under the `@next` dist-tag** (currently 1.12.13). Installing `vidstack` without the `@next` specifier ships a pre-Svelte-5 build. HLS streaming requires `hls.js` on non-Safari (Safari has native HLS); Vidstack auto-dyn-imports `hls.js` when present.

## Decision

- Pin `vidstack@npm:vidstack@^1.12.13` via the `@next` dist-tag in `@sveltesentio/media/player`. Published ranges on downstream apps must use the explicit `@next` tag or pin `>=1.12 <2`.
- Pin `hls.js@^1.6.16`. Safari path uses native HLS automatically; Vidstack dynamically imports `hls.js` only on non-Safari.
- Component: `<MediaPlayer src alt poster ...>` — thin runes wrapper over Vidstack primitives with accessibility defaults (captions toggle, keyboard controls).
- HEVC / alternate codec override exposed as opt-in prop; framework does not force codec policy.

## Alternatives considered

- **Shaka Player** — excellent DASH support but weaker HLS DX on non-Safari; more weight than we need.
- **video.js** — older lineage; accessibility defaults lag Vidstack.
- **Raw `<video>`** — no captions, no adaptive, no keyboard parity without rewriting Vidstack.
- **Vidstack `latest` (0.6.15)** — pre-Svelte-5; would block runes migration.

## Consequences

**Positive**:

- Svelte 5-native media player with accessibility defaults.
- Adaptive HLS + DASH + MP4 via the same component.
- revenge's migration is a one-shot version bump.

**Negative / trade-offs**:

- `@next` dist-tag is Vidstack's choice; must re-audit annually whether `latest` rolls over.
- `hls.js` is a ~60 KB gzipped payload; dyn-import keeps it off Safari bundles.

**Documentation obligations**:

- `docs/compose/media-player.md` — HLS vs DASH vs MP4, captions, keyboard controls.
- `@sveltesentio/media/player` AGENTS.md — **explicit warning about `@next` dist-tag**.
- Migration note: any app on `vidstack@latest` (legacy 0.6.x) upgrades.

## Evidence

- `.workingdir/research/ecosystem-pass-1-summary.md:97-98` — D110 + D111 picks.
- npm registry (2026-04-17): `vidstack@latest = 0.6.15`, `vidstack@next = 1.12.13`.
- `.workingdir/research/deepread-revenge.md` — existing Vidstack usage.
