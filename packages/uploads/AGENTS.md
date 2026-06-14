# @sveltesentio/uploads — AGENTS.md

> Resumable uploads. Locked through [ADR-0041](../../docs/adr/0041-uploads-tus-exifr-filetype.md).

## Scope

| Concern | Library | Pin | Role |
|---|---|---|---|
| Resumable transfer | `tus-js-client` | `^4.3.1` | Wire-protocol client against Golusoris `storage/tus` |
| EXIF strip | `exifr` | `^7.1.3` | Privacy-by-default metadata removal before upload |
| Content sniff | `file-type` | `^22.0.1` | Magic-byte content-type validation (never trust `File.type`) |

This package ships three separable primitives — `validateUpload`, `stripExif`, `createResumableUpload` — each usable independently.

This package does **not**:

- Depend on Uppy — no Svelte binding, ships UI we don't always want. Uppy lives in [docs/compose/uploads-uppy.md](../../docs/compose/uploads-uppy.md) as opt-in.
- Own the server — Golusoris `storage/tus` + `storage/safety` + `storage/presign` do.
- Own the presigned-URL dance — that's a TanStack Query concern on the consumer side.

## Invariants

- **Validate before strip before upload.** Magic-byte check gates the pipeline; failed validation never reaches the tus client.
- **Validation is magic-byte only.** `File.type` is user-controlled; `file-type` sniffs the first bytes. Extensions are ignored.
- **EXIF strip is destructive.** Re-encode via canvas loses original byte-identity; documented trade-off. Consumers that need lossless strip must reach for a server-side tool.
- **Byte cap is enforced client-side AND server-side.** Client cap is UX; Golusoris `storage/safety` enforces the real cap.
- **No hidden retries.** tus handles resume; we don't wrap it in a second retry layer.

## Test policy

- Unit: `validateUpload` against magic-byte fixtures (JPEG, PNG, fake-PNG-that's-JS). `stripExif` snapshot of pre/post EXIF byte regions.
- Integration (planned): tus protocol round-trip against a stubbed endpoint.
- Coverage ≥ 70%.

## Common tasks

| Task | Command |
|---|---|
| Typecheck | `pnpm --filter @sveltesentio/uploads typecheck` |
| Unit tests | `pnpm --filter @sveltesentio/uploads test` |

## Related

- [ADR-0041](../../docs/adr/0041-uploads-tus-exifr-filetype.md) — three-library matrix.
- [docs/compose/uploads.md](../../docs/compose/uploads.md) — full recipes (pending).
- [docs/compose/uploads-uppy.md](../../docs/compose/uploads-uppy.md) — Uppy Dashboard opt-in (pending).
- Golusoris `storage/tus` + `storage/safety` + `storage/presign` — server counterparts.
