# File System Access API — desktop-class read/write with permission

The File System Access API lets a PWA read and write files directly
to the user's disk, with explicit per-file or per-directory permission.
It's the missing piece for desktop-class workflows: "open project",
"save as", "export directory tree".

Chromium-only today (Safari + Firefox ship `showOpenFilePicker` but
not directory pickers or save-back); treat it as **progressive
enhancement** over a fallback to drag-drop + download. Sibling to
[pwa.md](pwa.md) and [uploads.md](uploads.md).

## Related

- [uploads.md](uploads.md) — file input + tus-js-client for server
  uploads; different use case (send to server) vs. this recipe
  (keep on disk).
- [pwa.md](pwa.md) — service worker; not required for File System
  Access, but commonly paired.
- [collab-persistence.md](collab-persistence.md) — IDB-based offline
  state; File System Access is the export surface.
- [schemas.md](schemas.md) — Zod at the read boundary.
- [trusted-types.md](trusted-types.md) — CSP posture; no extra
  directives needed, but worth noting.
- [ADR-0041](../adr/0041-uploads-tus-exifr-filetype.md) — uploads
  pipeline (for the "send to server" distinction).

## When to reach for it

```text
Send a file to your server                → uploads.md (+ tus-js-client)
Load a file, process in-browser, download → showOpenFilePicker → blob URL
Work on a file, save changes back         → showOpenFilePicker + writable
"Open project" (directory tree access)    → showDirectoryPicker
"Export everything"                       → showSaveFilePicker (single)
Watch a directory for external changes    → not supported; use periodic poll
```

The fallback path for Safari / Firefox always exists: `<input type="file">`
for reads, `<a download>` blob URL for writes. Keep it; File System
Access is the **upgrade**, not the floor.

## Browser support (2026-04)

```text
Chromium (Chrome/Edge 86+)       showOpen/Save/DirectoryPicker ✅
Safari 15.2+ (iOS + desktop)     showOpenFilePicker only ⚠️
Firefox                          none ❌
```

Feature-detect every call site; ship the fallback first, the upgrade
second.

## Install

No npm dep — the API is native. A thin wrapper worth writing:

```ts
// src/lib/fs/index.ts
export function supportsFileSystemAccess(): boolean {
  return typeof window !== 'undefined'
    && 'showOpenFilePicker' in window;
}

export function supportsDirectoryPicker(): boolean {
  return typeof window !== 'undefined'
    && 'showDirectoryPicker' in window;
}

export function supportsSavePicker(): boolean {
  return typeof window !== 'undefined'
    && 'showSaveFilePicker' in window;
}
```

Every entry point starts with the detect.

## Read — `showOpenFilePicker`

```svelte
<!-- src/lib/fs/OpenButton.svelte -->
<script lang="ts">
  import { supportsFileSystemAccess } from '$lib/fs';

  let { accept, onFile }: {
    accept?: Record<string, string[]>;
    onFile: (file: File, handle?: FileSystemFileHandle) => void;
  } = $props();

  let input: HTMLInputElement | undefined = $state();

  async function openViaAPI() {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: accept ? [{ description: 'Files', accept }] : undefined,
        multiple: false,
        excludeAcceptAllOption: false,
      });
      const file = await handle.getFile();
      onFile(file, handle);
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return;
      throw err;
    }
  }

  function openViaInput() {
    input?.click();
  }

  function handleInput(event: Event) {
    const el = event.target as HTMLInputElement;
    const file = el.files?.[0];
    if (file) onFile(file);
    el.value = '';
  }
</script>

{#if supportsFileSystemAccess()}
  <button onclick={openViaAPI}>Open file…</button>
{:else}
  <button onclick={openViaInput}>Open file…</button>
  <input
    bind:this={input}
    type="file"
    accept={accept ? Object.keys(accept).join(',') : undefined}
    class="sr-only"
    onchange={handleInput}
  />
{/if}
```

Three invariants:

1. **Feature-detect → API-or-input bifurcation.** Both paths call the
   same `onFile` callback; consumers never see the branching.
2. **`AbortError` on dismiss is not an error.** Every picker throws
   `AbortError` when the user dismisses; swallow silently, don't toast.
3. **Handle is optional.** The fallback gives a `File` but no
   `FileSystemFileHandle`. Features that need save-back degrade
   gracefully.

## Save — `showSaveFilePicker` + `createWritable`

```svelte
<script lang="ts">
  import { supportsSavePicker } from '$lib/fs';

  async function saveAs(content: string | Blob, suggestedName: string) {
    if (supportsSavePicker()) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName,
          types: [{ description: 'Text', accept: { 'text/plain': ['.txt'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        return handle;
      } catch (err) {
        if ((err as DOMException).name === 'AbortError') return;
        throw err;
      }
    }

    // Fallback: download link.
    const blob = content instanceof Blob
      ? content
      : new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedName;
    a.click();
    URL.revokeObjectURL(url);
    return null;
  }
</script>
```

Two invariants:

1. **`writable.close()` in a `finally` or after a success.** A leaked
   writable stream holds a lock on the file; user can't re-save.
2. **Fallback downloads via blob URL, never data: URL.** data: URLs
   fail past ~2MB and pollute browser history. Always `URL.createObjectURL`
   + `revokeObjectURL`.

## Save-back — reuse the handle

The real payoff: open a file once, keep the handle, save back on
Cmd+S without a second picker:

```svelte
<script lang="ts">
  let content = $state<string>('');
  let handle = $state<FileSystemFileHandle | null>(null);
  let dirty = $state(false);

  async function open() {
    const [h] = await window.showOpenFilePicker();
    handle = h;
    content = await (await h.getFile()).text();
    dirty = false;
  }

  async function save() {
    if (!handle) return saveAs();
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
    dirty = false;
  }

  async function saveAs() {
    const h = await window.showSaveFilePicker({
      suggestedName: 'document.txt',
    });
    const w = await h.createWritable();
    await w.write(content);
    await w.close();
    handle = h;
    dirty = false;
  }

  $effect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

<header>
  <span>{handle?.name ?? 'Untitled'}{dirty ? ' •' : ''}</span>
  <button onclick={open}>Open…</button>
  <button onclick={save} disabled={!dirty}>Save</button>
  <button onclick={saveAs}>Save as…</button>
</header>

<textarea bind:value={content} oninput={() => (dirty = true)}></textarea>
```

Classic desktop-app save semantics. Cmd+S / Ctrl+S honored; unsaved
state marker (`•`) in the filename.

## Permission — `queryPermission` + `requestPermission`

Handles stored in IndexedDB survive reloads, but **permission does
not**. On reload, re-request:

```ts
async function ensureReadWrite(handle: FileSystemHandle): Promise<boolean> {
  const opts = { mode: 'readwrite' as const };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  if ((await handle.requestPermission(opts)) === 'granted') return true;
  return false;
}
```

`requestPermission` must be called in a user gesture (click / key).
Silent re-request after reload is not allowed; show a "Resume
editing" button that the user clicks to trigger the prompt.

## Persisting handles — IndexedDB

Handles serialize to IDB via structured clone:

```ts
import { openDB } from 'idb';

const dbPromise = openDB('sveltesentio-fs', 1, {
  upgrade(db) {
    db.createObjectStore('handles');
  },
});

export async function rememberHandle(key: string, handle: FileSystemHandle) {
  const db = await dbPromise;
  await db.put('handles', handle, key);
}

export async function recallHandle(
  key: string,
): Promise<FileSystemHandle | undefined> {
  const db = await dbPromise;
  return db.get('handles', key);
}
```

Pair with [collab-persistence.md](collab-persistence.md) IDB-purge
on logout — shared-device leak: handles for another user's files.
Purge `sveltesentio-fs` + all shell state when the session ends.

## Directory pickers — `showDirectoryPicker`

```svelte
<script lang="ts">
  async function openProject() {
    const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
    for await (const [name, entry] of dir.entries()) {
      console.warn('entry', name, entry.kind);
    }
  }
</script>
```

Directory handles iterate via `for await`. Each entry is `FileSystemFileHandle`
or `FileSystemDirectoryHandle`. Recurse yourself for full trees; the
API has no single-call "give me everything" primitive.

**Safety**: `mode: 'readwrite'` triggers a strong browser warning
("Let site edit files? This site will be able to change files in
this folder.") — match it with a matching in-app description of what
you'll do.

## Blocked directories

Chromium blocks sensitive paths (`/` on macOS/Linux, `C:\Windows`,
user profile root, Downloads). Trying to pick them throws
`SecurityError`. Do not surprise the user with an error — prefer a
defensive copy:

```ts
async function safePickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch (err) {
    if ((err as DOMException).name === 'AbortError') return null;
    if ((err as DOMException).name === 'SecurityError') {
      alert('That folder is protected by your browser. Pick a different folder.');
      return null;
    }
    throw err;
  }
}
```

## Validating file contents — schemas

Files from disk are **user input**. Parse with Zod at the boundary:

```ts
import { z } from 'zod';

const ProjectSchema = z.object({
  version: z.literal('1'),
  title: z.string(),
  nodes: z.array(z.object({ id: z.string(), type: z.string() })),
});

async function loadProject(handle: FileSystemFileHandle) {
  const file = await handle.getFile();
  if (file.size > 10 * 1024 * 1024) throw new Error('File too large');
  const text = await file.text();
  const parsed = ProjectSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error('Invalid project format');
  return parsed.data;
}
```

Three defensive layers per [schemas.md](schemas.md):

1. **Size cap before `text()`.** A 1 GB file blocks the tab.
2. **`JSON.parse` in a `try/catch`** if untrusted (handled above by
   `safeParse` on raw via outer layer — add explicit catch for
   malformed JSON).
3. **Zod `safeParse`** for shape. Always narrow the type before use.

## Drag-and-drop — same primitive, different UX

File System Access integrates with drag-and-drop via
`DataTransferItem.getAsFileSystemHandle()`:

```svelte
<div
  ondragover={(e) => e.preventDefault()}
  ondrop={async (e) => {
    e.preventDefault();
    const items = Array.from(e.dataTransfer?.items ?? []);
    for (const item of items) {
      if (item.kind !== 'file') continue;
      const handle = await (item as any).getAsFileSystemHandle?.();
      if (handle) onFile(await handle.getFile(), handle);
      else onFile(item.getAsFile()!);
    }
  }}
>
  Drop a file here
</div>
```

Progressive enhancement: browsers without the API give a `File` via
`getAsFile()`; browsers with it give a full handle.

## Offline editing (`requestPersistentStorage`)

File System Access handles survive reload, but the browser may evict
IndexedDB (where handles live) under storage pressure. Request
persistent storage to reduce eviction risk:

```ts
if (navigator.storage?.persist) {
  const granted = await navigator.storage.persist();
  if (!granted) {
    console.warn('Storage is not persistent; handles may be evicted.');
  }
}
```

Same request sibling pattern as [collab-persistence.md](collab-persistence.md)
and [pwa.md](pwa.md). One call at app bootstrap covers all three.

## Testing

Unit tests: mock `showOpenFilePicker` + handle chain:

```ts
import { vi } from 'vitest';

const mockFile = new File(['{"version":"1","title":"T","nodes":[]}'], 'p.json');
const mockHandle = {
  getFile: vi.fn().mockResolvedValue(mockFile),
  createWritable: vi.fn().mockResolvedValue({
    write: vi.fn(),
    close: vi.fn(),
  }),
};
(window as any).showOpenFilePicker = vi.fn().mockResolvedValue([mockHandle]);
```

E2E: Playwright with file-chooser event (File System Access path
isn't easily scriptable in Playwright; test the fallback):

```ts
test('open fallback', async ({ page }) => {
  await page.goto('/editor');
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('text=Open file…'),
  ]);
  await fileChooser.setFiles('test-fixtures/project.json');
  await expect(page.getByText('test-fixtures/project.json')).toBeVisible();
});
```

Gate the API path behind a manual test run; there's no way to grant
picker permission automatically.

## Accessibility

`showOpenFilePicker` and friends are user-gesture native dialogs;
they inherit OS-level a11y. The **trigger** must still be keyboard-
reachable:

```svelte
<button onclick={openViaAPI}>Open file…</button>
```

Not `div onclick` — button + Enter/Space native keyboard support.
Focus returns to the trigger after the picker closes; no custom
focus management needed.

## Privacy + security

- The picker UI is the user's consent moment. Do not trick them into
  picking something they didn't mean to — wide directory pickers
  with misleading labels violate user trust + browser policy.
- Never upload a picked file to the server without a second prompt
  (`Send to server?`). File System Access is **local** by design;
  silently piping to a server is a surprise.
- Don't log file paths or contents. The browser already classifies
  `handle.name` as sensitive; treat it the same.

## Anti-patterns

- **Calling the API without feature detection.** Firefox throws
  `TypeError`; app crashes. Always detect.
- **Treating `AbortError` as a real error.** Users dismiss pickers;
  swallow silently.
- **Long-lived writable streams.** Lock the file; prevents external
  edits. Open → write → close per save, not "open once, write often".
- **Storing handles without IDB purge on logout.** Shared-device
  leak — next user's session can resume editing prior user's files.
- **No permission re-request on reload.** Handle works, `createWritable`
  throws `NotAllowedError`. Always `ensureReadWrite` before write.
- **Silent upload to server after pick.** Violates "local by design"
  contract. User clicks "save", not "upload".
- **`mode: 'readwrite'` when `read` suffices.** Triggers the strong
  warning for no reason. Use the minimum mode.
- **Recursing directories without a progress UI.** Large trees block
  the main thread. Iterate in batches; show `role="status"` during
  the walk.
- **No Zod on file contents.** User files are untrusted. Size-cap +
  parse + validate at the boundary.
- **Polyfilling with `browser-fs-access`.** The polyfill papers over
  real capability differences; the fallback belongs in your app code
  where you can control the UX. Skip the polyfill.
- **`data:` URL saves.** Breaks past ~2 MB; blob URL + `revokeObjectURL`
  every time.
- **Bypassing user gesture for `requestPermission`.** Silently fails;
  user sees no prompt, thinks the feature is broken.
- **Persisting handles without `storage.persist()`.** Eviction under
  pressure loses "recent files". Pair the requests.

## References

- [uploads.md](uploads.md) — "send to server" path.
- [pwa.md](pwa.md) — service worker + persistent storage.
- [collab-persistence.md](collab-persistence.md) — IDB purge on logout.
- [schemas.md](schemas.md) — Zod boundaries.
- File System Access spec (WICG):
  <https://wicg.github.io/file-system-access/>.
- MDN File System Access:
  <https://developer.mozilla.org/en-US/docs/Web/API/File_System_API>.
- web.dev guide:
  <https://web.dev/articles/file-system-access>.
- Chrome launch post:
  <https://developer.chrome.com/docs/capabilities/web-apis/file-system-access>.
