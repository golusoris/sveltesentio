# ADR-0041: Uploads stack — `tus-js-client` + `exifr` + `file-type` inside `@sveltesentio/uploads`

- **Status**: Accepted
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D100 + D102 in `.workingdir/research/decisions-needed.md`

## Context

Uploads decompose into three separable concerns:

1. **Resumable transfer** — Golusoris runs a tus-protocol server (`storage/tus`). Browser-side needs a wire-protocol client.
2. **EXIF stripping** — images from cameras carry GPS + device metadata; must strip before upload for privacy.
3. **Content-type + byte-cap validation** — don't trust `File.type` (user-controlled); sniff magic bytes.

Uppy is a popular meta-library bundling these concerns, but it's framework-agnostic with a Dashboard UI (Transloadit product), lacks an official Svelte binding, and overshoots for the compose-level cases where apps want their own UI.

## Decision

Pin in `@sveltesentio/uploads`:

- `tus-js-client@^4.3.1` — resumable upload client against Golusoris tus endpoint.
- `exifr@^7.1.3` — browser-first EXIF reader; strip via re-encode canvas or via `exifr`'s mutation helpers.
- `file-type@^22.0.1` — magic-byte content sniffing (default + `/types` exports are browser-safe).
- Byte-cap validator as a small helper (`validateUpload({ maxBytes, allowed: ['image/*'] })`).

Uppy held as `docs/compose/uploads-uppy.md` for consumers who want the Dashboard UI (opt-in, not framework lock).

## Alternatives considered

- **Uppy as framework default** — no Svelte binding; ships UI we don't always want.
- **Hand-roll tus** — reinvents protocol; `tus-js-client` is the canonical client.
- **`piexifjs`** — older EXIF parser; less maintained than `exifr`.
- **Trust `File.type`** — user-controlled; insufficient for validation gates.

## Consequences

**Positive**:

- Three composable concerns, each with the best-in-stack client.
- Privacy-by-default (EXIF strip) for user-submitted images.
- Content validation catches type-spoofing (`.png` that's actually JS).

**Negative / trade-offs**:

- Consumers that want Uppy's Dashboard opt into `docs/compose/uploads-uppy.md` separately.
- `exifr` strip via re-encode changes image encoding; documented trade-off (file size, quality).

**Documentation obligations**:

- `docs/compose/uploads.md` — upload lifecycle: validate → strip → resume-upload.
- `docs/compose/uploads-uppy.md` — Uppy opt-in for Dashboard UX.
- `@sveltesentio/uploads` AGENTS.md — three-dep matrix + Golusoris tus contract.

## Evidence

- `.workingdir/research/ecosystem-pass-1-summary.md:95-96` — D100 + D102 picks.
- `.workingdir/research/ecosystem-batch-d.md` — upload lane decomposition.
- Golusoris `storage/tus` + `storage/safety` + `storage/presign` — server-side counterparts.
