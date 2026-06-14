<!--
@component
Emulator — thin SSR-safe EmulatorJS mount.

EmulatorJS is a self-hosted/CDN WASM bundle, not an npm module. This component
owns only the browser wiring: behind a `BROWSER` guard it injects the loader
script + `EJS_*` globals (via `injectEmulatorScript`) targeting the inner
`<div>`, and tears them down on destroy. All testable logic lives in
`./loader` (config + injection) and `./cores` (platform → core) and is
unit-tested there; this `.svelte` file is intentionally untested per repo
precedent (collab/realtime ship components untested).

The matching CSP additions are in `./csp` — pair `emulatorCspDirectives(...)`
with `@sveltesentio/core`'s `strictCsp` so the WASM/worker/blob needs are
allowed under an otherwise-strict policy.
-->
<script lang="ts">
  import { BROWSER } from 'esm-env';
  import { injectEmulatorScript, type BuildEmulatorConfigOptions } from './loader.js';

  interface Props extends Omit<BuildEmulatorConfigOptions, 'player'> {
    /** DOM id of the mount element. EmulatorJS targets `#${mountId}`. */
    mountId?: string;
    /** Accessible label for the emulator region. */
    label?: string;
  }

  const {
    mountId = 'sveltesentio-emulator',
    label = 'Game emulator',
    ...config
  }: Props = $props();

  let host = $state<HTMLDivElement | null>(null);

  $effect(() => {
    if (!BROWSER || !host) return;
    const { cleanup } = injectEmulatorScript(
      { ...config, player: `#${mountId}` },
      { document, window: globalThis as unknown as Record<string, unknown> },
    );
    return cleanup;
  });
</script>

<div
  bind:this={host}
  id={mountId}
  class="ssentio-emulator"
  role="application"
  aria-label={label}
></div>

<style>
  .ssentio-emulator {
    width: 100%;
    aspect-ratio: 4 / 3;
    background: #000;
  }

  .ssentio-emulator :global(canvas) {
    width: 100%;
    height: 100%;
  }
</style>
