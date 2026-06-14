# Toast — `@sveltesentio/ui/toast` (svelte-sonner + mode-watcher + presets)

`@sveltesentio/ui/toast` is a thin wrapper around `svelte-sonner@^1.1`
that enforces the **preset-aware sizing** invariant: padding, font-size,
and max-width scale with the active `@sveltesentio/ui/preset-*`
(`desktop` / `10-foot` / `handheld`). It composes `mode-watcher` for
theme sync and Lucide icons for loading / success / error / info /
warning states.

See [ADR-0007](../adr/0007-svelte-sonner-toast-primitive.md) (primitive
lock) and [ADR-0016](../adr/0016-ui-toast-thin-wrapper-preset-sizing.md)
(preset-aware wrapper decision). Related:
[ADR-0047](../adr/0047-per-interface-presets.md) (per-interface
presets), [ADR-0030](../adr/0030-mode-watcher-pin.md) (mode-watcher).

## Install

```bash
pnpm add @sveltesentio/ui svelte-sonner mode-watcher
```

Peer range: `svelte-sonner@^1.1`, `mode-watcher@^1`, `svelte@^5`.
Lucide icons come in via `@sveltesentio/ui` (ADR-0002 default).

## Mount once

One `<Toaster>` per app, at the root layout — same contract as sonner
upstream:

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import { Toaster } from '@sveltesentio/ui/toast';
  let { children } = $props();
</script>

{@render children()}

<Toaster />
```

`<Toaster>` reads the active preset from
`:root[data-preset]` (set by `withPreset()` in `hooks.server.ts`) and
applies the matching size tokens. No config needed for defaults.

### Props

```ts
type ToasterProps = {
  position?: 'top-left' | 'top-right' | 'top-center' |
             'bottom-left' | 'bottom-right' | 'bottom-center';
  richColors?: boolean;      // default true — status-tinted bg per type
  closeButton?: boolean;     // default true
  expand?: boolean;          // default false — stack vs expand on hover
  duration?: number;         // default 4000ms
  gap?: number;              // default 12px (desktop) / 16px (handheld) / 24px (10-foot)
};
```

The defaults differ per preset — handheld gets larger tap targets, 10-foot
gets larger gap for cross-room legibility. Override explicitly only if
you need to.

## Fire a toast

```svelte
<script lang="ts">
  import { toast } from '@sveltesentio/ui/toast';

  async function save() {
    const id = toast.loading('Saving…');
    try {
      await api.PUT('/flow', { body: { /* … */ } });
      toast.success('Saved', { id });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed', { id });
    }
  }
</script>

<button onclick={save}>Save</button>
```

Passing the `id` returned from `toast.loading` updates the same toast
in-place — no stacked "Saving… / Saved" pair. This is the pattern sonner
upstream recommends; the wrapper preserves it.

### API

```ts
toast(message: string, opts?: ToastOptions): string; // returns id
toast.success(message: string, opts?: ToastOptions): string;
toast.error(message: string, opts?: ToastOptions): string;
toast.info(message: string, opts?: ToastOptions): string;
toast.warning(message: string, opts?: ToastOptions): string;
toast.loading(message: string, opts?: ToastOptions): string;
toast.promise<T>(p: Promise<T>, msgs: { loading; success; error }): Promise<T>;
toast.dismiss(id?: string): void; // omit id to dismiss all
toast.message(message: string, opts?: ToastOptions): string; // plain, no icon
```

`toast.promise` is the sugar for the pattern above:

```ts
toast.promise(api.PUT('/flow', { body }), {
  loading: 'Saving…',
  success: () => 'Saved',
  error: (e) => (e instanceof Error ? e.message : 'Save failed'),
});
```

## Errors + `ProblemError` interop

When an API call rejects with a `ProblemError` (RFC 9457 — see
[http-client.md](http-client.md)), pass it directly:

```ts
import { problemToMessage } from '@sveltesentio/core/http';

try {
  await api.POST('/thing', { body });
} catch (err) {
  toast.error(problemToMessage(err));
}
```

`problemToMessage` reads `title` when present, falls back to
`detail`, then `status`. For structured errors (validation, MFA),
prefer surfacing in-form instead of toasting.

## Action toasts

```ts
toast('Draft saved', {
  action: {
    label: 'Undo',
    onClick: () => restoreDraft(),
  },
});
```

The action button gets keyboard focus order + ARIA labelling from
sonner. 10-foot preset renders it larger — consistent with the sizing
invariant.

## Theming

Colors come from the same oklch tokens as the rest of
`@sveltesentio/ui` (see [theming.md](theming.md)):

- `success` → `--color-success`
- `warning` → `--color-warning`
- `danger` → `--color-danger` (used by `toast.error`)
- neutral → `--color-bg` / `--color-fg`

Dark mode syncs via `mode-watcher`'s `ModeWatcher` store — no extra
wiring. `<Toaster>` subscribes internally.

Never hard-code hex/HSL/oklch literals in a custom toast component;
override tokens at the preset layer instead.

## Preset-aware sizing

The wrapper's core invariant. Behavior per preset:

| Preset | Padding | Font-size | Max-width | Gap |
|---|---|---|---|---|
| `desktop` (default) | `12px 16px` | `0.875rem` | `356px` | `12px` |
| `handheld` | `16px 20px` | `1rem` | `90vw` | `16px` |
| `10foot` | `24px 32px` | `1.5rem` | `560px` | `24px` |

These are the wrapper's defaults, applied via
`:root[data-preset='...']` selectors. Override per-app:

```css
:root[data-preset='handheld'] [data-sonner-toast] {
  padding-block: 18px; /* custom for this app */
}
```

Color tokens stay shared across presets — only size scales
([ADR-0047](../adr/0047-per-interface-presets.md)).

## A11y

`svelte-sonner` announces toasts via `role="status"` (non-urgent) or
`role="alert"` (errors). The wrapper preserves this. Keyboard:

- `Alt+T` focuses the toast region (toasts are skipped in the normal
  tab order).
- `Esc` dismisses the focused toast.
- `Tab` / `Shift+Tab` cycles through action buttons inside the region.

Do **not** set `role` manually on a toast — sonner sets it per type.

## Testing

Component + unit:

```ts
import { render, screen } from '@testing-library/svelte';
import { toast, Toaster } from '@sveltesentio/ui/toast';

test('toast.success renders with status role', async () => {
  render(Toaster);
  toast.success('Saved');
  expect(await screen.findByRole('status', { name: /saved/i })).toBeInTheDocument();
});
```

Playwright for preset-scaling checks — set `data-preset='10foot'` on
`<html>` in a fixture, assert `max-width` via `getComputedStyle`.

## Anti-patterns

- **Multiple `<Toaster>` instances.** Toasts stack across every mounted
  Toaster. One at the root layout, done.
- **Toasting form validation errors.** Validation belongs inline with
  the field. Toast is for async results the user won't see another way.
- **Long toasts (`duration: 30000`).** Users assume toasts expire. For
  persistent state, use a banner / inline alert. Toast is transient by
  contract.
- **Hard-coded colors in a custom toast.** Use tokens — dark mode + per-tenant
  overrides cascade through the oklch pipeline.
- **Bypassing `toast.promise` for simple async.** Hand-written
  `loading` / `success` pairs forget the `id` round-trip and double-stack
  on re-render.
- **Skipping the wrapper.** `svelte-sonner` direct loses preset sizing
  + mode-watcher theme sync. ADR-0016's invariant requires the wrapper.
- **Using toast as the error surface for `ProblemError` validation
  details.** Map structured errors to form fields via
  `problemToFieldErrors` ([forms.md](forms.md)). Toast is the floor, not
  the ceiling.

## References

- ADR-0007 — `svelte-sonner` primitive lock.
- ADR-0016 — `ui/toast` preset-aware wrapper decision.
- ADR-0030 — `mode-watcher` pin.
- ADR-0047 — per-interface presets (size scales, color doesn't).
- [theming.md](theming.md) — oklch token pipeline.
- [http-client.md](http-client.md) — `ProblemError` shape + `problemToMessage`.
- svelte-sonner: <https://svelte-sonner.vercel.app>.
