# ADR-0055: Keep `@sveltesentio/media/image` wrapper with preset-aware invariants

- **Status**: Accepted
- **Date**: 2026-04-18
- **Deciders**: @lusoris (user)
- **D-row**: D171 in `.workingdir/research/decisions-needed.md`

## Context

D171 asked whether `@sveltesentio/media/image` should remain a sub-export under `@sveltesentio/media` or be downgraded to a `docs/compose/image.md` recipe. The research dossier's initial verdict was "open — no app has a full image pipeline yet", and in the post-streamlining round the D171 line was marked "downgrade to compose" without user closure.

Two events forced a re-examination in April 2026:

1. **ADR-0047 locked per-interface presets** (`ui/preset-{desktop,10foot,handheld,dashboard}`). Each preset has different image-loading defaults: handheld wants aggressive `loading="lazy"` + `decoding="async"` + viewport-aware `sizes`, 10-foot (TV) wants eager loading above the fold and larger `srcset` upper bounds to avoid pixelation on 4K/8K panels, dashboard wants moderate lazy-loading plus a low-LQIP placeholder to reduce layout shift.
2. **Issue #12 module-surface diff audit (2026-04-18)** classified every module. The audit recommended **keep** for `media/image` on the grounds that preset-aware image handling scales with interface-type — which the streamlining rule explicitly protects via the "preset theming invariant" (see user feedback memory).

The streamlining rule says: "don't wrap upstream libs that already compose cleanly" — but it has a carve-out for concerns that scale with interface-type preset. Image handling is one of those concerns.

## Decision

Keep `@sveltesentio/media/image` as a thin wrapper with preset-aware defaults. The public surface:

1. **`<Image>` component** — takes `src`, `alt` (required), `preset?` (auto-detected from the consumer's preset context, overridable). Emits a native `<img>` with:
   - `loading` — `lazy` on handheld + dashboard, `eager` on 10-foot above-the-fold (via `priority` prop), `lazy` on desktop with `priority` opt-in.
   - `decoding` — always `async`.
   - `srcset` / `sizes` — generated from a `widths?` prop + the active preset's viewport bounds (handheld tops out at 828w; 10-foot starts at 1920w).
   - CSP `img-src` boundary respected — the component never attempts to inline-swap via `new Image()`; all loads go through the rendered `<img>`, so the consumer's CSP policy governs.
2. **`stripExif(file: File)`** — server-side helper (re-exports from `@sveltesentio/uploads` per [ADR-0041](0041-uploads-tus-exifr-filetype.md)). The image wrapper itself is client-only; EXIF stripping stays in the uploads pipeline, but the image sub-export documents the dependency so consumers doing client uploads land on the correct helper.
3. **LQIP placeholder opt-in** — `placeholder="lqip"` prop renders a base64-inline blur-up using the preset's LQIP budget (handheld: 32×32; desktop: 48×48; 10-foot: 64×64). Generation happens at build time via a Vite plugin registered by `@sveltesentio/core` (see [ADR-0019](0019-openapi-fetch-rfc9457.md)-adjacent vite-plugin scope).
4. **No image CDN coupling** — the wrapper emits a plain `srcset`, so consumers can point at any CDN (Cloudinary, imgix, Cloudflare Images, bunny.net). Preset-level `sizes` generation is CDN-agnostic.

## Alternatives considered

- **Downgrade to `docs/compose/image.md`** (the original streamlining verdict). Rejected — preset-aware defaults are the exact case the preset theming invariant protects. A recipe that says "on 10-foot, set `loading='eager'` above the fold; on handheld, set `loading='lazy'`; on dashboard, tune `sizes` to viewport width ÷ 3" is exactly the kind of boilerplate every app would re-write and get wrong in different ways. Centralising it in a wrapper prevents drift.
- **Adopt Svelte's `enhanced:img` directly as the canonical path.** Rejected as the *only* path — `enhanced:img` is build-time + file-based, which works for static image assets but not for runtime-discovered URLs (user-uploaded images, CMS-sourced, S3 signed URLs). The wrapper accommodates both: static imports route through `enhanced:img` under the hood; runtime URLs use the plain `<img>` path with preset-aware attributes.
- **Use `unpic` as the default.** Evaluated — `unpic` handles multi-CDN `srcset` generation well, but bundles CDN-specific URL builders that many consumers won't use. A preset-aware wrapper that emits a plain `srcset` leaves CDN choice to the consumer and is smaller.
- **Use `svelte-easy-crop` for crop-and-zoom.** Out of scope for the default image surface — crop/zoom is a different feature (image editing), not a loading concern. Can ship later as a separate `./image/crop` sub-export if demand materialises.

## Consequences

**Positive**:
- Closes D171; the research dossier no longer flags the module as open.
- Apps get correct preset-aware loading defaults without per-app boilerplate. Handheld apps lazy-load by default; 10-foot apps get eager above-the-fold + higher `srcset` ceilings; dashboard apps get moderate-lazy + LQIP.
- LQIP placeholder opt-in addresses CLS (layout shift) budget pressure from [docs/principles.md](../principles.md) §2.9 (CLS < 0.1).
- CDN-agnostic — consumers pick their image CDN independently.

**Negative / trade-offs**:
- Maintenance surface grows by one sub-export. Kept minimal: `<Image>` + `stripExif` re-export + LQIP placeholder = ~200 LoC total target.
- Preset detection requires the consumer to have the preset context wired (via `@sveltesentio/ui/presets`). Apps that don't use presets fall back to `desktop` defaults; documented in AGENTS.md.
- LQIP placeholder generation requires a Vite plugin. Build-time cost scales with image count; large asset trees may need `lqip: false` opt-out.

**Documentation obligations**:
- `packages/media/AGENTS.md` — replace `./image` row's "ADR: TBD" with a link to this ADR.
- [docs/compose/image-optimization.md](../compose/image-optimization.md) — extend to cover the `<Image>` component's preset-aware behaviour (currently documents the raw `enhanced:img` + CDN composition).
- `.workingdir/research/decisions-still-open.md` — mark D171 closed by this ADR.
- `.workingdir/research/drow-adr-map.md` — update D171 row to cite ADR-0055.

## Evidence

- [.workingdir/research/decisions-needed.md](../../.workingdir/research/decisions-needed.md) D171 — original decision request, with the three invariants (`loading="lazy"`, `decoding="async"`, CSP `img-src`, EXIF strip on upload).
- [.workingdir/research/module-surface-diff.md](../../.workingdir/research/module-surface-diff.md) — issue #12 audit, recommended **keep** with preset-aware rationale.
- [ADR-0047](0047-per-interface-presets.md) — per-interface preset system that gives the wrapper its preset detection.
- [ADR-0041](0041-uploads-tus-exifr-filetype.md) — uploads stack that owns EXIF stripping; the image wrapper re-exports the helper.
- [ADR-0029](0029-tailwind4-safe-area-utilities.md) — safe-area-aware layouts that interact with `sizes` generation on handheld.
- Feedback memory `feedback_preset_theming_invariant.md` — the carve-out that makes "thin wrapper + preset-aware defaults" a justified exception to the streamlining rule.
- Svelte enhanced images docs — https://svelte.dev/docs/kit/images — the build-time path the wrapper delegates to for static assets.
