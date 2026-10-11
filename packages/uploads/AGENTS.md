# @sveltesentio/uploads — AGENTS.md

> Resumable uploads. Locked through [ADR-0041](../../docs/adr/0041-uploads-tus-exifr-filetype.md).

## Scope

| Concern            | Library         | Pin       | Role                                                         |
| ------------------ | --------------- | --------- | ------------------------------------------------------------ |
| Resumable transfer | `tus-js-client` | `^4.3.1`  | Wire-protocol client against Golusoris `storage/tus`         |
| EXIF strip         | `exifr`         | `^7.1.3`  | Privacy-by-default metadata removal before upload            |
| Content sniff      | `file-type`     | `^22.0.1` | Magic-byte content-type validation (never trust `File.type`) |

Package ships three separable primitives — `validateUpload`, `stripExif`, `createResumableUpload` — each usable independently.

Package does **not**:

- Depend on Uppy — no Svelte binding, ships UI not always wanted. Uppy lives in [docs/compose/uploads-uppy.md](../../docs/compose/uploads-uppy.md) as opt-in.
- Own server — Golusoris `storage/tus` + `storage/safety` + `storage/presign` do.
- Own presigned-URL dance — TanStack Query concern on consumer side.

## Invariants

- **Validate before strip before upload.** Magic-byte check gates pipeline; failed validation never reaches tus client.
- **Validation magic-byte only.** `File.type` user-controlled; `file-type` sniffs first bytes. Extensions ignored.
- **EXIF strip destructive.** Re-encode via canvas loses original byte-identity; documented trade-off. Consumers needing lossless strip must reach for server-side tool.
- **Byte cap enforced client-side AND server-side.** Client cap UX; Golusoris `storage/safety` enforces real cap.
- **No hidden retries.** tus handles resume; package does not wrap in second retry layer.

## Test policy

- Unit: `validateUpload` against magic-byte fixtures (JPEG, PNG, fake-PNG-that's-JS). `stripExif` snapshot of pre/post EXIF byte regions.
- Integration (planned): tus protocol round-trip against stubbed endpoint.
- Coverage ≥ 70%.

## Common tasks

| Task       | Command                                         |
| ---------- | ----------------------------------------------- |
| Typecheck  | `pnpm --filter @sveltesentio/uploads typecheck` |
| Unit tests | `pnpm --filter @sveltesentio/uploads test`      |

## Related

- [ADR-0041](../../docs/adr/0041-uploads-tus-exifr-filetype.md) — three-library matrix.
- [docs/compose/uploads.md](../../docs/compose/uploads.md) — full recipes (pending).
- [docs/compose/uploads-uppy.md](../../docs/compose/uploads-uppy.md) — Uppy Dashboard opt-in (pending).
- Golusoris `storage/tus` + `storage/safety` + `storage/presign` — server counterparts.
