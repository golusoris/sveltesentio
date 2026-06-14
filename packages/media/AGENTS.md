# @sveltesentio/media — AGENTS.md

> Video / audio / image player surface. v0.2.0 ships the headless logic core; the `vidstack` UI shell + `./carousel` are follow-throughs. Phase 10 per [.workingdir/PLAN.md](../../.workingdir/PLAN.md).

## Status (reconciles README ↔ AGENTS — issue #67)

- **Landed in v0.2.0:** `./player` headless model (`pickRendition`, `buildMediaSessionMetadata`, the `playbackReducer` play/pause/quality machine, `createHlsAttachment`) + `./image` `srcset` / `sizes` builders. Pure, framework-agnostic, unit-tested.
- **Follow-through (not in v0.2.0):** the `<Player>` UI shell over `vidstack@next`, the `./carousel` embla re-export, and LQIP/`<Image>` component wrapper. These pull heavy runtime deps and are deferred so this package stays dependency-light.

## Scope

| Sub-export | Status | Contents | ADR |
|---|---|---|---|
| `./player` | **landed** | Headless HLS rendition picking, OS media-session metadata, play/pause/quality state machine, bring-your-own-`hls.js` attachment seam | [ADR-0042](../../docs/adr/0042-vidstack-next-hls.md) |
| `./image` | **landed** | Pure `srcset` / `sizes` / responsive-attr builders (template-driven, query-merge fallback) | [ADR-0055](../../docs/adr/0055-media-image-keep-wrapper.md) |
| `<Player>` UI | follow-through | Thin runes shell over `vidstack@next` 1.12.13 with a11y defaults | [ADR-0042](../../docs/adr/0042-vidstack-next-hls.md) |
| `./carousel` | follow-through | shadcn-svelte Carousel (embla) re-export + reduced-motion + target-size overrides | [ADR-0012](../../docs/adr/0012-embla-carousel-via-shadcn.md) |

## `./player` headless design (issues #67 / #68)

The engine logic is factored **out** of any UI shell so a downstream already on
raw `hls.js` (e.g. revenge) adopts it incrementally without swapping its player:

- **Separate renditions.** `HlsRendition` models un-muxed audio/video; `pickRendition` honours `maxHeight` + `preferCodec` (HEVC over H.264 fallback) so quality and audio-track switching stay independent concerns.
- **BYO `hls.js`.** `createHlsAttachment(HlsCtor, { config })` injects the constructor — this package neither bundles nor dynamically imports `hls.js`; it is an **optional** peer. Constructor config passes straight through.
- **State machine.** `playbackReducer` is a pure reducer; invalid transitions are no-ops (never throws). Quality selection is orthogonal to the play/pause lifecycle.
- **OS chrome hook.** `buildMediaSessionMetadata` returns a plain `MediaMetadataInit`-compatible object; the caller owns the `navigator.mediaSession` DOM boundary.

**EmulatorJS does NOT live here.** It ships as a standalone `@sveltesentio/game` package — the ~40 MB cores would bloat every media consumer (D113 locked, Phase 2 backlog).

## Critical pin — `vidstack`

- **`vidstack@next`** (currently `1.12.13`) — the `latest` dist-tag is the legacy 0.6.15 line. Downstream pinning `vidstack@latest` breaks when 0.6.x goes unmaintained (revenge antipattern row).
- **`hls.js@^1.6.16`** — dynamic-imported via Vidstack provider; Safari uses native HLS automatically.

## Invariants

- **Captions required for any consumer-supplied video** — `<Player>` refuses to mount without `tracks` prop or an explicit `tracks={[]}` opt-out. WCAG 2.2 AA 1.2.2 enforcement.
- **Autoplay is off by default.** Consumers opt in with `autoplay` prop, and the component sets `muted` automatically (browser autoplay policy).
- **HEVC support is an opt-in prop** — `hevcFallback="sdr"` default; `hevcFallback="require"` throws if browser can't decode.
- **Reduced-motion** — carousel auto-advance respects `prefers-reduced-motion: reduce` (override via `autoplayRespectReducedMotion={false}` on accessible marketing pages).
- **Target size** — carousel nav buttons default to `size="icon"` (28 px) on desktop and auto-upgrade to 44 × 44 CSS px on touch / TV presets. Default `icon-sm` fails WCAG 2.5.8 enhanced; documented in [ADR-0012](../../docs/adr/0012-embla-carousel-via-shadcn.md).

## Rejected alternatives

- **Shaka Player** — larger bundle; DASH-first; we're HLS-first per revenge adoption.
- **video.js** — legacy DOM API, no Svelte 5 integration.
- **plyr** — no HLS.js adapter shipped, manual wiring needed.

## Test policy

- **v0.2.0 (landed):** pure-logic unit tests in `test/` cover every `./player` and `./image` export, including rendition tie-breaks, codec preference + fallback, the full state-machine transition table (valid + no-op), the injected-`hls.js` attach/destroy order, and `srcset` / `sizes` edge cases (query-merge, hash preservation, token templates).
- **Follow-through (with the UI shell):** visual regression per preset (desktop / 10-foot / handheld); keyboard-only playback control tests (Space / Arrow / M / F / C per Vidstack defaults); HLS manifest fixtures under `test/fixtures/hls/`.

## Common tasks

| Task | Command |
|---|---|
| Typecheck | `pnpm --filter @sveltesentio/media typecheck` |
| Unit tests | `pnpm --filter @sveltesentio/media test` |

## Related ADRs

- [ADR-0042](../../docs/adr/0042-vidstack-next-hls.md) — Vidstack `@next` + hls.js pin.
- [ADR-0012](../../docs/adr/0012-embla-carousel-via-shadcn.md) — Carousel via shadcn + a11y overrides.
- [ADR-0055](../../docs/adr/0055-media-image-keep-wrapper.md) — `./image` kept as preset-aware wrapper (closes D171).
- [docs/migrations/downstream-antipatterns-v0.1.md](../../docs/migrations/downstream-antipatterns-v0.1.md) — revenge `vidstack@latest` antipattern.
