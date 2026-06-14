# Uploads with Uppy Dashboard — opt-in for batch / multi-source UX

`@sveltesentio/uploads` ships the headless three-stage pipeline
(`validate → strip → upload`) per
[ADR-0041](../adr/0041-uploads-tus-exifr-filetype.md) — see
[uploads.md](uploads.md). This recipe covers the **Uppy Dashboard
opt-in** for consumers who want batch UX with drag-drop, webcam,
camera, screen capture, Google Drive / Dropbox / Instagram pickers,
and a polished progress board out of the box.

Uppy is **not** a framework default. ADR-0041 explicitly holds it
opt-in because:

- No official Svelte binding (web-component shim only).
- Ships UI we don't always want (apps with custom upload surfaces
  conflict).
- Bundles its own tus client — duplicates `tus-js-client` already
  pinned by `@sveltesentio/uploads`.

When the trade-off is right (admin tools, content pipelines,
moderator UIs), Uppy saves weeks. This recipe documents the
trade-off, the integration pattern, and the boundary contract that
keeps EXIF stripping + magic-byte validation intact.

Related: [uploads.md](uploads.md) (default headless path),
[schemas.md](schemas.md) (Zod boundary validation),
[safe-area.md](safe-area.md) (Dashboard responsiveness on PWAs).

## When Uppy is the right call

| Use case | Default ([uploads.md](uploads.md)) | Uppy Dashboard (this recipe) |
|---|---|---|
| Single avatar / hero image | ✅ | ❌ overkill |
| Inline form attachment | ✅ | ❌ Dashboard hijacks layout |
| Batch import (10-1000 files) | ⚠️ build your own grid | ✅ Dashboard ready |
| Webcam / screencap capture | ❌ wire by hand | ✅ plugin |
| Google Drive / Dropbox picker | ❌ | ✅ plugin (via Companion) |
| Mobile camera roll | ⚠️ via `<input capture>` | ✅ plugin |
| Custom branded UI | ✅ | ⚠️ skinning required |
| Bundle budget critical | ✅ ~30 KB | ❌ ~150 KB Dashboard + plugins |

Default to [uploads.md](uploads.md). Reach for Uppy when the
batch / multi-source / picker matrix justifies the bundle.

## Install

```bash
pnpm add @uppy/core @uppy/dashboard @uppy/tus
# common plugins (cherry-pick — each adds bundle)
pnpm add @uppy/webcam @uppy/screen-capture @uppy/image-editor
# remote sources require a Companion server
pnpm add @uppy/google-drive @uppy/dropbox @uppy/instagram
```

Uppy's CSS:

```ts
import '@uppy/core/dist/style.min.css';
import '@uppy/dashboard/dist/style.min.css';
```

Bundle the CSS via Vite — don't `<link>` from a CDN (SRI per ADR
principles + version drift risk).

## Component pattern

```svelte
<!-- src/lib/uploads/UppyDashboard.svelte -->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import Uppy from '@uppy/core';
  import Dashboard from '@uppy/dashboard';
  import Tus from '@uppy/tus';
  import Webcam from '@uppy/webcam';
  import { stripExif, validateMagicBytes } from '@sveltesentio/uploads';
  import '@uppy/core/dist/style.min.css';
  import '@uppy/dashboard/dist/style.min.css';

  let {
    endpoint = '/api/uploads',
    maxBytes = 50 * 1024 * 1024,
    allowed = ['image/png', 'image/jpeg', 'image/webp'],
    onComplete = () => {},
  }: {
    endpoint?: string;
    maxBytes?: number;
    allowed?: string[];
    onComplete?: (result: { successful: unknown[]; failed: unknown[] }) => void;
  } = $props();

  let mount: HTMLDivElement;
  let uppy: Uppy | null = null;

  onMount(() => {
    uppy = new Uppy({
      restrictions: {
        maxFileSize: maxBytes,
        allowedFileTypes: allowed,           // Uppy uses File.type — DO NOT trust
      },
      onBeforeFileAdded: async (file) => {
        const sniff = await validateMagicBytes(file.data, { allowed, maxBytes });
        if (!sniff.ok) {
          uppy?.info({ message: `Rejected: ${sniff.reason}` }, 'error', 5000);
          return false;                      // hard reject
        }
        if (file.type?.startsWith('image/')) {
          file.data = await stripExif(file.data);   // mutate to stripped blob
          file.size = file.data.size;
        }
        return true;
      },
    })
      .use(Dashboard, {
        target: mount,
        inline: true,
        proudlyDisplayPoweredByUppy: false,
        height: 470,
        theme: 'auto',                       // sync with prefers-color-scheme
        note: `Max ${maxBytes / 1e6} MB · ${allowed.join(', ')}`,
        locale: { strings: { dropPasteFiles: 'Drop files here or %{browseFiles}' } },
      })
      .use(Webcam, { target: Dashboard })
      .use(Tus, {
        endpoint,
        retryDelays: [0, 1000, 3000, 5000, 10_000],
        chunkSize: 4 * 1024 * 1024,
        removeFingerprintOnSuccess: true,
      });

    uppy.on('complete', (result) => {
      onComplete({ successful: result.successful, failed: result.failed });
    });
  });

  onDestroy(() => {
    uppy?.destroy();
  });
</script>

<div bind:this={mount} role="region" aria-label="File upload"></div>
```

Five invariants:

1. **`onBeforeFileAdded` runs `validateMagicBytes` + `stripExif`.**
   Uppy's `restrictions.allowedFileTypes` checks `File.type` only —
   user-controlled per [uploads.md](uploads.md). Magic-byte sniff is
   the trust boundary.
2. **EXIF strip mutates `file.data` in place.** Uppy passes the
   mutated blob to tus; original is discarded.
3. **`@uppy/tus`, not Uppy's XHR upload.** Resumable per ADR-0041 +
   wire-compatible with Golusoris `storage/tus`.
4. **`removeFingerprintOnSuccess: true`** + per-user purge on logout
   matches the [uploads.md](uploads.md) shared-device security
   contract.
5. **`theme: 'auto'`** so dark mode follows the rest of the app
   per [theming.md](theming.md). Override with explicit
   `'light'/'dark'` if your shell already controls scheme.

## Companion server (remote sources)

Google Drive / Dropbox / Instagram / Facebook pickers require an
**Uppy Companion** server. Companion proxies OAuth + downloads to
your origin so user credentials never touch the browser:

```text
Browser → Uppy Dashboard → Companion (Node) → Google Drive API
                                ↓
                              Your tus server
```

Companion is a Node.js service. Two deployment options:

| Option | When |
|---|---|
| Self-host `@uppy/companion` Node service | Full control; preferred |
| Transloadit Companion (SaaS) | Don't want to run Node; vendor lock |

Self-host docker:

```yaml
# docker-compose.yml fragment
companion:
  image: transloadit/companion
  environment:
    COMPANION_SECRET: ${COMPANION_SECRET}
    COMPANION_PROTOCOL: https
    COMPANION_DOMAIN: companion.yourapp.com
    COMPANION_DATADIR: /companion-data
    COMPANION_GOOGLE_KEY: ${GOOGLE_KEY}
    COMPANION_GOOGLE_SECRET: ${GOOGLE_SECRET}
  volumes:
    - companion-data:/companion-data
```

Wire from the client:

```ts
.use(GoogleDrive, { companionUrl: 'https://companion.yourapp.com' })
.use(Dropbox, { companionUrl: 'https://companion.yourapp.com' })
```

CSP `connect-src` must allowlist the Companion origin.

## A11y

Uppy's Dashboard ships reasonable a11y but verify per release:

- `role="region" aria-label="File upload"` on the mount node — gives
  SR users a landmark.
- File grid uses `role="list"` internally with focusable items.
- Cancel buttons have `aria-label` per file.
- Drag-drop has a keyboard equivalent ("browse files" link).

Run [a11y-audit-runbook.md](a11y-audit-runbook.md) after major
Uppy bumps — third-party UI is not exempt from axe.

## Bundle size

Per release, the Dashboard + tus + 1 plugin lands ~150 KB
gzipped. Lazy-load via dynamic import:

```ts
let UppyDashboard: typeof import('./UppyDashboard.svelte').default;

async function open() {
  if (!UppyDashboard) {
    UppyDashboard = (await import('./UppyDashboard.svelte')).default;
  }
  showModal = true;
}
```

Don't ship Uppy on routes that don't use it. Vite chunks per dynamic
import automatically.

## Theming integration

Uppy uses CSS custom properties — bridge to oklch tokens per
[theming.md](theming.md):

```css
:global(.uppy-Root) {
  --uppy-c-blue: var(--color-accent);
  --uppy-c-red: var(--color-error);
  --uppy-c-green: var(--color-success);
  --uppy-c-bg: var(--color-bg);
  --uppy-c-fg: var(--color-fg);
}
```

Don't hex-override Uppy's vars — defeats the contrast contract.

## Server-side re-validation (mandatory)

Per [uploads.md](uploads.md), client-side `validateMagicBytes` is
**defense in depth**, not the trust boundary. Golusoris
`storage/safety` re-runs validation on the server:

```text
Browser (Uppy validate + strip) → tus server
                                       ↓
                                  storage/safety (re-validate magic bytes + cap bytes)
                                       ↓
                                  storage/scan (clamav async, optional)
                                       ↓
                                  S3 / blob store
```

Never assume client-side validation is the gate. Uppy plugins can
be bypassed by any sufficiently determined HTTP client.

## Testing

Uppy ships `@uppy/test-suite` but it's brittle. For component
testing, mount the Dashboard + drive a fake `File`:

```ts
import { render, screen } from '@testing-library/svelte';
import UppyDashboard from '$lib/uploads/UppyDashboard.svelte';
import { vi } from 'vitest';

test('Dashboard rejects spoofed file via onBeforeFileAdded', async () => {
  const onComplete = vi.fn();
  const { container } = render(UppyDashboard, { props: { onComplete } });

  const file = new File(['<script>alert(1)</script>'], 'evil.png', {
    type: 'image/png',                       // user-controlled lie
  });

  // dispatch via the file input Uppy renders
  const input = container.querySelector('input[type=file]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file] });
  input.dispatchEvent(new Event('change', { bubbles: true }));

  await screen.findByText(/Rejected/);
  expect(onComplete).not.toHaveBeenCalled();
});
```

Playwright integration test against a real tus server is worth the
budget — Uppy's wire interactions surface only with a real server.

## Migration from raw Dashboard / non-pipeline integration

If you adopted Uppy *without* the `@sveltesentio/uploads` validate +
strip pipeline:

1. Add `onBeforeFileAdded` hook with `validateMagicBytes` + `stripExif`.
2. Replace `@uppy/xhr-upload` with `@uppy/tus`.
3. Wire `removeFingerprintOnSuccess: true` + per-user purge.
4. Bridge Uppy CSS vars to oklch tokens per [theming.md](theming.md).
5. Server-side: confirm `storage/safety` is in the chain — don't
   trust client validation alone.

Each step is mechanical; the whole migration is one PR.

## Anti-patterns

- **Skipping `onBeforeFileAdded` validation.** Uppy's
  `allowedFileTypes` trusts `File.type`. Magic-byte sniff is
  the trust boundary.
- **`@uppy/xhr-upload` instead of `@uppy/tus`.** Loses resumability
  on Golusoris's tus server.
- **Companion-less remote sources.** Browser-side OAuth to Google /
  Dropbox leaks client secret. Use Companion.
- **Bundling Uppy on every route.** Lazy-load — 150 KB on routes
  that never upload is wasteful.
- **Hex-overriding Uppy CSS vars.** Breaks theming contrast contract.
  Bridge via oklch tokens.
- **`proudlyDisplayPoweredByUppy: true` in production.** Branding
  link to a third party from your UI; turn off.
- **Default sink: `successful` array consumed without server-side
  re-validation.** Client said it was OK. Server confirms.
- **Storing `tus-js-client` fingerprints across users on shared
  devices.** Same purge-on-logout obligation as [uploads.md](uploads.md).
- **Skipping a11y audit on Dashboard.** Third-party UI is in scope.
- **Wrapping Uppy in `@sveltesentio/uploads/uppy`.** Per ADR-0041,
  Uppy is opt-in compose, not a framework default. App-owned.

## References

- ADR-0041 — uploads stack (tus + exifr + file-type) holds Uppy
  opt-in.
- [uploads.md](uploads.md) — default headless three-stage pipeline.
- [schemas.md](schemas.md) — Zod at boundaries.
- [theming.md](theming.md) — oklch CSS-var bridge.
- [a11y-audit-runbook.md](a11y-audit-runbook.md) — axe over
  third-party UI too.
- [safe-area.md](safe-area.md) — Dashboard on PWA mobile insets.
- Uppy docs: <https://uppy.io/docs/>.
- Companion docs: <https://uppy.io/docs/companion/>.
- tus protocol: <https://tus.io/protocols/resumable-upload>.
