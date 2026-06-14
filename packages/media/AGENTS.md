# @sveltesentio/media — AGENTS.md

> Video / audio / image player surface. Phase 10 per [.workingdir/PLAN.md](../../.workingdir/PLAN.md).

## Scope

| Sub-export | Contents | ADR |
|---|---|---|
| `./player` | Thin wrapper over `vidstack@next` 1.12.13 + `hls.js@^1.6` for video/audio | [ADR-0042](../../docs/adr/0042-vidstack-next-hls.md) |
| `./image` | Responsive `<Image>` with `srcset` / `sizes` + preset-aware dimensions + LQIP | [ADR-0055](../../docs/adr/0055-media-image-keep-wrapper.md) |
| `./carousel` | shadcn-svelte Carousel (embla) re-export + reduced-motion + target-size overrides | [ADR-0012](../../docs/adr/0012-embla-carousel-via-shadcn.md) |

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

- Visual regression for player UI per preset (desktop / 10-foot / handheld).
- Keyboard-only playback control tests (Space / Arrow / M / F / C per Vidstack defaults).
- HLS manifest fixtures committed to `test/fixtures/hls/`.

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
