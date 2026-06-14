# Uploads — `tus-js-client` + `exifr` + `file-type`

`@sveltesentio/uploads` composes three concerns per
[ADR-0041](../adr/0041-uploads-tus-exifr-filetype.md):

1. **Content-type + byte-cap validation** — sniff magic bytes; don't
   trust `File.type` (user-controlled).
2. **EXIF stripping** — remove GPS / device metadata from images
   before upload (privacy default).
3. **Resumable transfer** — `tus-js-client@^4.3.1` against Golusoris's
   `storage/tus` endpoint.

Pipeline order is fixed: **validate → strip → upload**. Skipping
validation ships spoofed content-types to the server; skipping strip
leaks metadata; skipping tus gives up resumability.

For apps that want the Uppy Dashboard UI, see
[uploads-uppy.md](uploads-uppy.md) (opt-in, pending).

## Install

```bash
pnpm add tus-js-client exifr file-type
```

Peers: `tus-js-client@^4.3`, `exifr@^7.1`, `file-type@^22.0`.
`file-type` ships both default and `/types` (browser-safe) exports;
use the browser entry:

```ts
import { fileTypeFromBlob } from 'file-type/browser';
```

## The three-stage pipeline

```ts
// src/lib/uploads/pipeline.ts
import { fileTypeFromBlob } from 'file-type/browser';
import * as exifr from 'exifr';
import * as tus from 'tus-js-client';

export type UploadPolicy = {
  maxBytes: number;
  allowed: string[];           // e.g. ['image/jpeg', 'image/png', 'application/pdf']
  stripExif?: boolean;          // default true for image/*
};

export type UploadResult = {
  url: string;                  // tus Location header
  bytes: number;
  mime: string;
};

export class UploadRejection extends Error {
  constructor(
    message: string,
    public code: 'too_large' | 'disallowed_type' | 'spoofed_type' | 'corrupt',
  ) {
    super(message);
  }
}

export async function uploadFile(
  file: File,
  policy: UploadPolicy,
  endpoint: string,
): Promise<UploadResult> {
  const prepared = await validateAndStrip(file, policy);
  return await tusUpload(prepared.blob, endpoint, prepared.mime);
}
```

Split validate/strip from transport so tests don't need a live server.

### Stage 1: validate

```ts
async function validateAndStrip(file: File, policy: UploadPolicy) {
  if (file.size > policy.maxBytes) {
    throw new UploadRejection(
      `File exceeds ${policy.maxBytes} bytes`,
      'too_large',
    );
  }

  const sniffed = await fileTypeFromBlob(file);
  if (!sniffed) {
    throw new UploadRejection('Unrecognized file type', 'corrupt');
  }

  const matches = policy.allowed.some((a) =>
    a.endsWith('/*')
      ? sniffed.mime.startsWith(a.slice(0, -1))
      : sniffed.mime === a,
  );
  if (!matches) {
    throw new UploadRejection(
      `Type ${sniffed.mime} not in allowed list`,
      'disallowed_type',
    );
  }

  // Spoof check — declared vs sniffed.
  if (file.type && file.type !== sniffed.mime) {
    throw new UploadRejection(
      `Declared ${file.type} but content is ${sniffed.mime}`,
      'spoofed_type',
    );
  }

  const shouldStrip =
    (policy.stripExif ?? true) && sniffed.mime.startsWith('image/');

  const blob = shouldStrip ? await stripExif(file, sniffed.mime) : file;
  return { blob, mime: sniffed.mime };
}
```

Magic-byte sniffing beats `.ext` and `File.type` for every attack
class we care about. `file-type` recognizes ~200 formats — narrow to
your allowlist at the `allowed` gate.

### Stage 2: EXIF strip

Two viable strategies:

**(a) Re-encode via canvas (lossy for JPEG; universal).**

```ts
async function stripExif(file: File, mime: string): Promise<Blob> {
  if (mime === 'image/png' || mime === 'image/webp') {
    // PNG/WebP exif chunks are rare; canvas round-trip is safe.
  }

  const img = await loadImage(file);
  const canvas = new OffscreenCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);

  const quality = mime === 'image/jpeg' ? 0.92 : undefined;
  return await canvas.convertToBlob({ type: mime, quality });
}

async function loadImage(file: File): Promise<ImageBitmap> {
  return await createImageBitmap(file);
}
```

Quality 0.92 matches JPEG's "high" default. Document this in your
upload UX — camera-original pixels are not preserved.

**(b) `exifr` mutation (lossless; JPEG-only; keeps bytes).**

```ts
import { gps } from 'exifr';

async function stripExif(file: File, mime: string): Promise<Blob> {
  if (mime !== 'image/jpeg') return file;
  const buf = new Uint8Array(await file.arrayBuffer());
  const stripped = removeJpegAppMarkers(buf); // custom helper
  return new Blob([stripped], { type: 'image/jpeg' });
}
```

`removeJpegAppMarkers` walks APP0..APPn JPEG segments and drops
EXIF (APP1) and XMP (APP1 "http://ns.adobe.com/xap/1.0/"). ~40 LOC;
keep in `$lib/uploads/jpeg-strip.ts`. Pros: lossless bytes. Cons:
JPEG-only and touches file format; (a) is safer default.

Default to (a); opt into (b) when byte preservation matters (e.g.
archival uploads where re-encode is unacceptable).

### Stage 3: tus upload

```ts
function tusUpload(blob: Blob, endpoint: string, mime: string): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const upload = new tus.Upload(blob, {
      endpoint,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      metadata: {
        filename: (blob as File).name ?? 'upload',
        filetype: mime,
      },
      chunkSize: 4 * 1024 * 1024,
      onError: (err) => reject(err),
      onSuccess: () => {
        resolve({
          url: upload.url!,
          bytes: blob.size,
          mime,
        });
      },
    });

    // Resume from prior session if we have fingerprints cached.
    upload
      .findPreviousUploads()
      .then((prev) => {
        if (prev.length) upload.resumeFromPreviousUpload(prev[0]);
        upload.start();
      });
  });
}
```

`retryDelays` is the backoff ladder; `chunkSize` at 4 MiB balances
per-chunk overhead and retry granularity (subdo default). Golusoris
tus expects `PATCH` with `Content-Type: application/offset+octet-stream`
— `tus-js-client` handles the protocol.

## Progress + cancellation UI

```svelte
<script lang="ts">
  import { uploadFile, UploadRejection } from '$lib/uploads/pipeline';
  import { toast } from '@sveltesentio/ui/toast';

  let progress = $state(0);
  let uploader = $state<tus.Upload | null>(null);

  async function onFile(file: File) {
    try {
      const result = await uploadFile(file, {
        maxBytes: 20 * 1024 * 1024,
        allowed: ['image/jpeg', 'image/png', 'image/webp'],
      }, '/api/uploads');
      toast.success('Upload complete', { description: result.url });
    } catch (err) {
      if (err instanceof UploadRejection) {
        toast.error(err.message, { description: err.code });
      } else throw err;
    }
  }
</script>

<input
  type="file"
  accept="image/jpeg,image/png,image/webp"
  onchange={(e) => e.currentTarget.files?.[0] && onFile(e.currentTarget.files[0])}
/>

{#if uploader}
  <progress max="100" value={progress} aria-label="Upload progress"></progress>
  <button type="button" onclick={() => uploader?.abort()}>Cancel</button>
{/if}
```

The `accept` attribute narrows the native picker but is **not** a
security boundary — the validator is. Always run stage 1.

## Server contract (Golusoris)

```text
POST   /api/uploads            → 201 + Location: /api/uploads/{id}
PATCH  /api/uploads/{id}       → 204 + Upload-Offset
HEAD   /api/uploads/{id}       → 200 + Upload-Offset + Upload-Length
DELETE /api/uploads/{id}       → 204 (revoke partial)
```

Auth is via HttpOnly session cookie (see
[auth-oidc.md](auth-oidc.md)). tus sends `Cookie` automatically on
same-origin uploads. For cross-origin, the server must emit
`Access-Control-Allow-Credentials: true` and `tus-js-client` uses
`withCredentials: true` — pass via `{ headers, removeFingerprintOnSuccess: true }`.

## Server-side re-validation

Client sniffing is a UX gate, not a trust boundary. Golusoris
re-sniffs in `storage/safety` before persisting:

```go
// pseudo
mime := mimetype.DetectReader(body)
if !allowed(mime) {
  return http.StatusUnsupportedMediaType
}
```

Never accept the client's claimed mime as authoritative. See
Golusoris `storage/safety/` README.

## Concurrency

Limit concurrent uploads:

```ts
import pLimit from 'p-limit';
const limit = pLimit(3);

await Promise.all(files.map((f) => limit(() => uploadFile(f, policy, endpoint))));
```

tus handles per-upload retry; `p-limit` caps bandwidth / server
connections. Default 3 is subdo's empirical sweet spot; adjust for
your network.

## Accessibility

| Control | Requirement |
|---|---|
| File input | Keyboard-reachable (`tabindex` default); label via `<label for>` |
| Drag-drop zone | Also accept keyboard-triggered file picker; `role="region"` + `aria-label` |
| Progress bar | `<progress>` element or `role="progressbar"` + `aria-valuenow/min/max` |
| Cancel button | Standard button; announce "Upload cancelled" via `aria-live="polite"` |
| Error | `role="alert"` (blocks flow); describe why + how to fix |

Never drag-drop-only. File-picker fallback is mandatory for WCAG
2.1.1.

## Testing

```ts
import { uploadFile, UploadRejection } from '$lib/uploads/pipeline';

// Unit: validation
test('rejects spoofed type', async () => {
  const jsContent = new File([`alert(1)`], 'photo.png', { type: 'image/png' });
  await expect(
    uploadFile(jsContent, { maxBytes: 1e6, allowed: ['image/*'] }, '/api/uploads'),
  ).rejects.toMatchObject({ code: 'spoofed_type' });
});

// Integration: tus round-trip
test('resumes after simulated disconnect', async () => {
  const server = await startTusServer();
  const file = new File([new Uint8Array(10 * 1024 * 1024)], 'big.bin', {
    type: 'application/octet-stream',
  });
  // kill connection at 50%, assert resume
  await server.close();
});
```

Playwright e2e: `page.setInputFiles()` then assert upload completion
via a UI signal (toast / route transition), not network mocks.

## Anti-patterns

- **Trusting `File.type`.** User-controlled. Always sniff.
- **Skipping EXIF strip for user-submitted images.** Ships GPS to
  server + downstream storage. Privacy default violation.
- **Client-only validation.** UX gate, not trust boundary. Server
  must re-validate.
- **Using FormData + `fetch` instead of tus for large files.** No
  resume on network flake; full restart on any chunk failure.
- **Bundling Uppy for the sake of a progress bar.** Uppy is a
  Dashboard + transport. If you only need transport, use
  `tus-js-client` direct. Uppy opt-in via
  [uploads-uppy.md](uploads-uppy.md).
- **Accepting `image/*` without byte cap.** DoS surface. Always
  pair `allowed` with `maxBytes`.
- **Sending exif strip via re-encode without UX warning.** Users
  expect camera-original pixels. Document or offer the lossless
  JPEG-marker strip as an opt-in.
- **Fingerprint leakage across users on shared devices.**
  `tus-js-client` stores fingerprints in `localStorage`. Clear on
  logout alongside IDB (see
  [collab-persistence.md](collab-persistence.md) purge recipe).

## References

- ADR-0041 — tus + exifr + file-type pin.
- [auth-oidc.md](auth-oidc.md) — cookie-based auth for tus.
- [toast.md](toast.md) — progress/error UX.
- Golusoris `storage/tus` + `storage/safety` READMEs.
- tus protocol: <https://tus.io/protocols/resumable-upload>.
- `tus-js-client`: <https://github.com/tus/tus-js-client>.
- `file-type`: <https://github.com/sindresorhus/file-type>.
- `exifr`: <https://github.com/MikeKovarik/exifr>.
