/**
 * `@sveltesentio/ui/toast` — thin `svelte-sonner` wrapper with preset-aware
 * sizing (ADR-0016). The toast *primitive* ships from `svelte-sonner` (an
 * OPTIONAL peer the consuming app installs); this surface adds the
 * interface-type sizing contract that sonner does not expose natively.
 *
 * Re-export the primitive in your app where the peer is installed:
 *
 * ```ts
 * import { Toaster, toast } from 'svelte-sonner';
 * import { toastPreset } from '@sveltesentio/ui/toast';
 *
 * const p = toastPreset('handheld');
 * // <Toaster position={p.position} toastOptions={{ style: p.style }} />
 * ```
 */

export { toastPreset } from './preset.js';
export type { ToastPreset, ToastPosition } from './preset.js';
