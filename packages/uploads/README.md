# @sveltesentio/uploads

> Resumable uploads — `tus-js-client` transfer + `exifr` EXIF strip + `file-type` magic-byte sniff.

## Status

✅ v0.2.0 — transport-agnostic `validateUpload` (magic-byte sniff via `file-type`,
never trusts `File.type`) + `detectFileType`, and `stripExif` (destructive
canvas re-encode) + `readExif`. **No tus dependency** in the validate/strip path
(`./validate`, `./exif` sub-exports), so a downstream with no tus server can
validate + strip then POST via `FormData`. The `tus` resumable wrapper
(`createResumableUpload`) ships on the `./resumable` sub-export. Locked through [ADR-0041](../../docs/adr/0041-uploads-tus-exifr-filetype.md).

## Surface

```ts
import { validateUpload, stripExif, createResumableUpload } from '@sveltesentio/uploads';

const file = input.files?.[0];
await validateUpload(file, { maxBytes: 25 * 1024 * 1024, allowed: ['image/jpeg', 'image/png'] });

const safe = await stripExif(file);

const upload = createResumableUpload({
  endpoint: '/api/uploads/tus',
  file: safe,
  metadata: { filename: file.name, filetype: safe.type },
});
upload.start();
```

## Opt-in extensions

- Uppy Dashboard UX: [`docs/compose/uploads-uppy.md`](../../docs/compose/uploads-uppy.md) — opt-in recipe, not a framework lock.

## Design notes

- Three separable concerns, three libraries — avoid Uppy as default (no Svelte binding; ships UI we don't always want).
- Privacy-by-default: EXIF strip before tus upload so GPS + camera metadata never leave the browser.
- Never trust `File.type` — user-controlled; magic-byte sniff via `file-type` gates content-type.

## Server contract

Golusoris runs tus at `/storage/tus` via `storage/tus` + `storage/safety` + `storage/presign` modules. This package speaks the tus protocol against that endpoint.

## Related ADRs

- [ADR-0041](../../docs/adr/0041-uploads-tus-exifr-filetype.md) — tus + exifr + file-type matrix.
