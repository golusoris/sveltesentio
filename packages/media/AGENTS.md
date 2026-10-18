# @sveltesentio/media — AGENTS.md

> Video / audio / image player surface. v0.4.1 ships headless logic core + a11y `<Player>` shell, responsive `<Image>`, preset-aware `<Carousel>`. Phase 10 per `.workingdir/PLAN.md`.

## Status (reconciles README ↔ AGENTS — issue #67)

- **Landed (headless core):** `./player` headless model (`pickRendition`, `buildMediaSessionMetadata`, `playbackReducer` play/pause/quality machine, `createHlsAttachment`) + `./image` `srcset` / `sizes` builders. Pure, framework-agnostic, unit-tested.
- **Landed in v0.4.1 (UI shells):** `<Player>` a11y shell over `vidstack@next` (`./player/component` + `./player/controls`), responsive blur-up `<Image>` (`./image/component` + `./image/lqip`), preset-aware embla `<Carousel>` (`./carousel/component`), Playwright e2e harness (`e2e/`). 0.4.1 fix moved player-controls to import `@sveltesentio/core/problem` (subpath) -> server-only core barrel stays out of `<Player>` client bundle. Heavy runtime deps (`vidstack`, `hls.js`, `embla-carousel-svelte`) remain optional peers -> package stays dependency-light.

## Scope

| Sub-export                                                 | Status     | Contents                                                                                                                             | ADR                                                          |
| ---------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `./player`                                                 | **landed** | Headless HLS rendition picking, OS media-session metadata, play/pause/quality state machine, bring-your-own-`hls.js` attachment seam | [ADR-0042](../../docs/adr/0042-vidstack-next-hls.md)         |
| `./image`                                                  | **landed** | Pure `srcset` / `sizes` / responsive-attr builders (template-driven, query-merge fallback)                                           | [ADR-0055](../../docs/adr/0055-media-image-keep-wrapper.md)  |
| `<Player>` UI (`./player/component` + `./player/controls`) | **landed** | Thin runes shell over `vidstack@next` 1.12.13 with a11y defaults                                                                     | [ADR-0042](../../docs/adr/0042-vidstack-next-hls.md)         |
| `./carousel` (`./carousel/component`)                      | **landed** | embla `<Carousel>` (`embla-carousel-svelte`) + reduced-motion + target-size overrides                                                | [ADR-0012](../../docs/adr/0012-embla-carousel-via-shadcn.md) |

## `./player` headless design (issues #67 / #68)

Engine logic factored **out** of any UI shell -> downstream already on raw `hls.js` (e.g. revenge) adopts incrementally without swapping player:

- **Separate renditions.** `HlsRendition` models un-muxed audio/video; `pickRendition` honours `maxHeight` + `preferCodec` (HEVC over H.264 fallback) -> quality + audio-track switching stay independent concerns.
- **BYO `hls.js`.** `createHlsAttachment(HlsCtor, { config })` injects constructor — package neither bundles nor dynamically imports `hls.js`; optional peer. Constructor config passes straight through.
- **State machine.** `playbackReducer` pure reducer; invalid transitions no-ops (never throws). Quality selection orthogonal to play/pause lifecycle.
- **OS chrome hook.** `buildMediaSessionMetadata` returns plain `MediaMetadataInit`-compatible object; caller owns `navigator.mediaSession` DOM boundary.

**EmulatorJS does NOT live here.** Ships as standalone `@sveltesentio/emulator` package — ~40 MB cores bloat every media consumer (D113 locked).

## Critical pin — `vidstack`

- **`vidstack@next`** (currently `1.12.13`) — `latest` dist-tag = legacy 0.6.15 line. Downstream pinning `vidstack@latest` breaks when 0.6.x goes unmaintained (revenge antipattern row).
- **`hls.js@^1.6.16`** — dynamic-imported via Vidstack provider; Safari uses native HLS automatically.

## Invariants

- **Captions required for any consumer-supplied video** — `<Player>` refuses to mount without `tracks` prop or explicit `tracks={[]}` opt-out. WCAG 2.2 AA 1.2.2 enforcement.
- **Autoplay off by default.** Consumers opt in with `autoplay` prop; component sets `muted` automatically (browser autoplay policy).
- **HEVC support opt-in prop** — `hevcFallback="sdr"` default; `hevcFallback="require"` throws if browser cannot decode.
- **Reduced-motion** — carousel auto-advance respects `prefers-reduced-motion: reduce` (override via `autoplayRespectReducedMotion={false}` on accessible marketing pages).
- **Target size** — carousel nav buttons default to `size="icon"` (28 px) on desktop; auto-upgrade to 44 × 44 CSS px on touch / TV presets. Default `icon-sm` fails WCAG 2.5.8 enhanced; documented in [ADR-0012](../../docs/adr/0012-embla-carousel-via-shadcn.md).

## Rejected alternatives

- **Shaka Player** — larger bundle; DASH-first; this package HLS-first per revenge adoption.
- **video.js** — legacy DOM API, no Svelte 5 integration.
- **plyr** — no HLS.js adapter shipped, manual wiring needed.

## Test policy

- **Headless core (landed):** pure-logic unit tests in `test/` cover every `./player` and `./image` export. Covers rendition tie-breaks, codec preference + fallback, full state-machine transition table (valid + no-op). Covers injected-`hls.js` attach/destroy order. Covers `srcset` / `sizes` edge cases (query-merge, hash preservation, token templates).
- **UI shells (landed in v0.4.1):** Playwright e2e harness under `e2e/` (`playback.spec.ts`) drives keyboard-only playback control per Vidstack defaults. Component + a11y coverage for `<Player>`, `<Image>`, `<Carousel>` shells.

## Common tasks

| Task       | Command                                       |
| ---------- | --------------------------------------------- |
| Typecheck  | `pnpm --filter @sveltesentio/media typecheck` |
| Unit tests | `pnpm --filter @sveltesentio/media test`      |
| e2e tests  | `pnpm --filter @sveltesentio/media test:e2e`  |

## Related ADRs

- [ADR-0042](../../docs/adr/0042-vidstack-next-hls.md) — Vidstack `@next` + hls.js pin.
- [ADR-0012](../../docs/adr/0012-embla-carousel-via-shadcn.md) — Carousel via shadcn + a11y overrides.
- [ADR-0055](../../docs/adr/0055-media-image-keep-wrapper.md) — `./image` kept as preset-aware wrapper (closes D171).
- [docs/migrations/downstream-antipatterns-v0.1.md](../../docs/migrations/downstream-antipatterns-v0.1.md) — revenge `vidstack@latest` antipattern.
