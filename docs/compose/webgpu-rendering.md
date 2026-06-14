# webgpu-rendering.md — composition recipe

> **3D / GPU-rendered scenes for sveltesentio:** Threlte v8 (Svelte 5
> bindings around three.js) as the default high-level surface, raw
> `WebGPURenderer` (three.js r170+) when you need direct GPU access,
> WebGL2 fallback when the device lacks WebGPU, **adapter-feature
> probing** before locking-in WebGPU paths, **WGSL compute shaders**
> via `WebGPURenderer.compute()`, **render budget budgets** (frame
> time + draw calls + memory) wired into the QoE collector from
> [video-streaming.md](video-streaming.md). Per
> [ADR-0042](../adr/0042-media-player-vidstack-hls.md) +
> [ADR-0029](../adr/0029-pwa-safe-area-tailwind4.md) GPU surfaces are
> **opt-in per app** — no consumer pays the threlte/three.js bundle
> tax unless they import it.

> **Held opt-in.** This recipe documents the path; the
> `@sveltesentio/media` package does not bundle threlte. A downstream
> app promotes it with a concrete need + ADR amendment.

## Related

- [media-player.md](media-player.md) — sibling 2D media surface
- [ai-in-browser-llm.md](ai-in-browser-llm.md) — sibling WebGPU
  consumer (LLM weights + KV cache); both must coexist on shared
  `GPUAdapter`
- [pwa.md](pwa.md) — service worker must precache `.glb` / `.ktx2`
  assets via correct strategies
- [image-optimization.md](image-optimization.md) — KTX2 + Basis
  Universal texture compression pipeline
- [observability.md](observability.md) — frame-time + draw-call
  metrics flow through the same OTel pipeline
- [trusted-types.md](trusted-types.md) — WGSL shader source must be
  trusted-bypass-explicit; user-supplied shaders are NEVER allowed
- [a11y-audit-runbook.md](a11y-audit-runbook.md) — 3D content needs
  alternate-text + reduced-motion gates
- [safe-area.md](safe-area.md) — full-bleed canvas must respect
  notch + home indicator
- [ADR-0042](../adr/0042-media-player-vidstack-hls.md) — media stack
- [ADR-0044](../adr/0044-ai-on-device-transformers.md) — coexistence
  with on-device AI on the same GPU

## When to use what

```text
Static 3D model viewer (one .glb, orbit controls)        → threlte (default)
Procedural scene with many primitives                    → threlte + custom <T> components
GPU compute (boids, particles, physics > 10k bodies)     → raw WebGPURenderer + WGSL compute
Custom render pass / G-buffer / deferred                 → raw three.js with WebGPURenderer
Map rendering (vector tiles, > 1M features)              → maplibre-gl + WebGPU layer (separate recipe)
Post-process effects (bloom, DoF, FXAA)                  → threlte/extras EffectComposer
Game-grade scene (animation graph, ECS, networking)      → out-of-scope; use Phaser/Babylon directly
```

If you only need an interactive image (zoom, pan, rotate flat assets)
prefer Canvas2D — WebGPU is overkill and the bundle cost is real.

## Adapter-feature probing first

Before locking the app into WebGPU, **probe**. WebGPU is a moving
target — Safari shipped GPUAdapter in 18.2; Firefox is enabled in 132+
behind a flag in some channels; Chrome stable since 113 on
desktop. **Always** call `navigator.gpu?.requestAdapter()` and inspect
`adapter.features` before constructing the renderer.

```ts
// src/lib/gpu/probe.ts
import { z } from 'zod';

export const GpuCapability = z.object({
  webgpuAvailable: z.boolean(),
  adapterName: z.string().nullable(),
  hasTimestampQuery: z.boolean(),
  hasShaderF16: z.boolean(),
  hasTextureCompressionBC: z.boolean(),
  hasTextureCompressionETC2: z.boolean(),
  hasTextureCompressionASTC: z.boolean(),
  // Fallback hint for the UI: which texture format do we ship?
  preferredTextureFormat: z.enum(['ktx2-bc', 'ktx2-etc2', 'ktx2-astc', 'jpg-png-fallback']),
  maxTextureDimension: z.number().int().positive(),
  isFallbackAdapter: z.boolean(),
});
export type GpuCapability = z.infer<typeof GpuCapability>;

export async function probeGpu(): Promise<GpuCapability> {
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
    return GpuCapability.parse({
      webgpuAvailable: false, adapterName: null,
      hasTimestampQuery: false, hasShaderF16: false,
      hasTextureCompressionBC: false, hasTextureCompressionETC2: false,
      hasTextureCompressionASTC: false,
      preferredTextureFormat: 'jpg-png-fallback',
      maxTextureDimension: 0, isFallbackAdapter: false,
    });
  }

  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) {
    return GpuCapability.parse({
      webgpuAvailable: false, adapterName: null,
      hasTimestampQuery: false, hasShaderF16: false,
      hasTextureCompressionBC: false, hasTextureCompressionETC2: false,
      hasTextureCompressionASTC: false,
      preferredTextureFormat: 'jpg-png-fallback',
      maxTextureDimension: 0, isFallbackAdapter: false,
    });
  }

  const features = adapter.features;
  return GpuCapability.parse({
    webgpuAvailable: true,
    adapterName: adapter.info?.description ?? adapter.info?.vendor ?? 'unknown',
    hasTimestampQuery: features.has('timestamp-query'),
    hasShaderF16: features.has('shader-f16'),
    hasTextureCompressionBC: features.has('texture-compression-bc'),
    hasTextureCompressionETC2: features.has('texture-compression-etc2'),
    hasTextureCompressionASTC: features.has('texture-compression-astc'),
    preferredTextureFormat: features.has('texture-compression-bc')
      ? 'ktx2-bc'
      : features.has('texture-compression-astc')
        ? 'ktx2-astc'
        : features.has('texture-compression-etc2')
          ? 'ktx2-etc2'
          : 'jpg-png-fallback',
    maxTextureDimension: adapter.limits.maxTextureDimension2D,
    isFallbackAdapter: adapter.isFallbackAdapter,
  });
}
```

The probe runs **once** at app load and is cached in a module-scope
`$state` rune. Components read `gpuCap.preferredTextureFormat` to pick
the right asset URL — never assume BC7.

## Install

```bash
pnpm add -F <app> three @threlte/core @threlte/extras
# Optional: WGSL compute helpers + KTX2 loader
pnpm add -F <app> @threlte/flex three-stdlib
```

> Pin `three` exactly — `@threlte/core` peer-depends on a narrow range.
> A `^` version on `three` will silently break threlte components on
> minor releases.

## Shape — bounded Zod for scene config

```ts
// src/lib/gpu/scene.ts
import { z } from 'zod';

export const SceneAsset = z.object({
  id: z.string().uuid(),
  url: z.string().url(),
  format: z.enum(['glb', 'gltf', 'usdz', 'obj']),
  // SHA-256 of the bytes, verified after fetch — protects against
  // mid-flight asset swap (CDN poisoning, MITM despite TLS).
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sizeBytes: z.number().int().min(1).max(50_000_000),
  // Bounded poly-budget — reject assets > 500k tris on mobile.
  triangleBudget: z.number().int().min(1).max(500_000),
  // License attribution required if non-CC0.
  attribution: z.object({
    author: z.string().min(1).max(200),
    license: z.enum(['CC0', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'commercial']),
    url: z.string().url(),
  }).nullable(),
});
export type SceneAsset = z.infer<typeof SceneAsset>;

export const SceneConfig = z.object({
  asset: SceneAsset,
  camera: z.object({
    fov: z.number().min(10).max(120),
    near: z.number().positive(),
    far: z.number().positive(),
    initialPosition: z.tuple([z.number(), z.number(), z.number()]),
  }),
  controls: z.enum(['orbit', 'first-person', 'none']),
  // Render budget — frame time in ms; over budget = drop quality.
  budget: z.object({
    frameTimeMs: z.number().min(8).max(33),    // 30–120fps
    maxDrawCalls: z.number().int().min(1).max(2000),
    maxTextureMb: z.number().int().min(1).max(2048),
  }),
});
export type SceneConfig = z.infer<typeof SceneConfig>;
```

`triangleBudget` and `frameTimeMs` are *contracts*, not soft hints —
the renderer aborts if the scene blows them.

## Reference patterns

### 1. Threlte default — `<Canvas>` + `<T>` declarative

```svelte
<!-- src/lib/components/SceneViewer.svelte -->
<script lang="ts">
  import { Canvas, T } from '@threlte/core';
  import { OrbitControls, useGltf } from '@threlte/extras';
  import { onMount } from 'svelte';
  import { probeGpu, type GpuCapability } from '$lib/gpu/probe';
  import type { SceneConfig } from '$lib/gpu/scene';

  let { config }: { config: SceneConfig } = $props();
  let cap = $state<GpuCapability | null>(null);
  let frameMsP95 = $state(0);
  let prefersReducedMotion = $state(false);

  onMount(async () => {
    cap = await probeGpu();
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    prefersReducedMotion = mq.matches;
    mq.addEventListener('change', e => prefersReducedMotion = e.matches);
  });

  const gltf = useGltf(config.asset.url);
</script>

{#if cap === null}
  <div role="status" aria-live="polite">Probing GPU...</div>
{:else if !cap.webgpuAvailable}
  <!-- Static fallback: poster image + alt text. -->
  <img src="{config.asset.url.replace(/\.glb$/, '.poster.jpg')}"
       alt="{config.asset.attribution?.author ?? 'Untitled'} — 3D model preview"
       loading="lazy" />
{:else}
  <Canvas rendererParameters={{ antialias: !cap.isFallbackAdapter }}>
    <T.PerspectiveCamera
      makeDefault
      fov={config.camera.fov}
      near={config.camera.near}
      far={config.camera.far}
      position={config.camera.initialPosition}
    >
      {#if config.controls === 'orbit'}
        <OrbitControls enableDamping={!prefersReducedMotion} />
      {/if}
    </T.PerspectiveCamera>
    <T.AmbientLight intensity={0.6} />
    <T.DirectionalLight intensity={1} position={[5, 10, 5]} castShadow />
    {#await gltf.then(g => g.scene) then scene}
      <T is={scene} />
    {/await}
  </Canvas>
{/if}
```

Key invariants:

- **`probeGpu()` BEFORE constructing `<Canvas>`** — never let three.js
  pick the renderer; you've already decided.
- **Static-image fallback** when WebGPU absent. The fallback is
  *content-equivalent*, not a "your browser is too old" message.
- **`prefersReducedMotion` gates damping + auto-rotation.** Vestibular
  sensitivity is real; respect it.
- **`<Canvas>` is dynamically imported** in the route's `+page.svelte`
  (`{#await import('./SceneViewer.svelte') then mod}` ...) so the
  three.js bundle doesn't enter the critical path.

### 2. WebGPURenderer escape hatch (raw three.js)

When you need direct GPU access (compute shaders, multi-pass,
custom blend modes):

```ts
// src/lib/gpu/wgpu-renderer.ts
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import type { SceneConfig } from './scene';

export async function createWebGpuRenderer(canvas: HTMLCanvasElement, config: SceneConfig) {
  const renderer = new WebGPURenderer({ canvas, antialias: true, alpha: false });
  await renderer.init(); // explicit init — async on WebGPU path

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    config.camera.fov,
    canvas.clientWidth / canvas.clientHeight,
    config.camera.near,
    config.camera.far,
  );
  camera.position.set(...config.camera.initialPosition);

  // Render budget enforcement
  let lastFrameTime = performance.now();
  let consecutiveOverBudget = 0;

  function tick() {
    const now = performance.now();
    const dt = now - lastFrameTime;
    lastFrameTime = now;

    if (dt > config.budget.frameTimeMs * 1.5) {
      consecutiveOverBudget++;
      if (consecutiveOverBudget > 30) {
        // Sustained over-budget for half a second @ 60fps — drop quality.
        renderer.setPixelRatio(Math.max(1, renderer.getPixelRatio() * 0.85));
        consecutiveOverBudget = 0;
      }
    } else {
      consecutiveOverBudget = Math.max(0, consecutiveOverBudget - 1);
    }

    renderer.renderAsync(scene, camera);
    return { dt, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
  }

  return { renderer, scene, camera, tick };
}
```

`renderer.renderAsync` is the WebGPU equivalent of `render` — it
returns a Promise that resolves when the GPU command buffer is
submitted. Don't `await` it inside the rAF callback; just fire-and-forget
the next frame.

### 3. WGSL compute shader (particles example)

```ts
// src/lib/gpu/compute-particles.ts
import { ComputeNode, instanceIndex, storage, vec3, sin, cos, time } from 'three/tsl';
import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';

export function createParticleSystem(renderer: WebGPURenderer, count: number) {
  const positions = new THREE.StorageBufferAttribute(count, 3);

  // TSL — three.js Shading Language; transpiles to WGSL.
  const computePosition = ComputeNode(() => {
    const i = instanceIndex;
    const t = time;
    const pos = storage(positions, 'vec3', count);
    pos.element(i).assign(vec3(
      sin(t.add(i.mul(0.01))).mul(50),
      cos(t.add(i.mul(0.013))).mul(50),
      sin(t.add(i.mul(0.017))).mul(50),
    ));
  })().compute(count);

  async function step() {
    await renderer.computeAsync(computePosition);
  }

  return { positions, step };
}
```

WGSL is the right surface for > 10k bodies. Below that count, CPU JS +
typed arrays + instanced rendering is faster (no PCIe round-trip).

### 4. Coexistence with on-device LLM (single GPU)

WebGPU exposes **one** `GPUAdapter` per origin. If
[ai-in-browser-llm.md](ai-in-browser-llm.md) is also active, both
paths share GPU memory. Coordinate via a module-scope mutex:

```ts
// src/lib/gpu/coordinator.ts
let gpuPriority: 'render' | 'llm' | 'idle' = 'idle';
const listeners = new Set<(p: typeof gpuPriority) => void>();

export function requestGpuPriority(who: 'render' | 'llm') {
  if (gpuPriority === who) return;
  gpuPriority = who;
  listeners.forEach(l => l(who));
}

export function onGpuPriorityChange(fn: (p: typeof gpuPriority) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
```

Renderer subscribes; when LLM inference starts the render loop drops
to 30fps; when LLM completes it returns to native refresh.

## Asset pipeline

- **Models**: GLB (preferred) or USDZ (Apple-flavored). Compress with
  `gltf-transform optimize --compress meshopt`.
- **Textures**: KTX2 + Basis Universal universal-format. `gltf-transform
  ktxtransfer` produces the BC/ETC/ASTC variants in one file; the GPU
  driver picks at upload.
- **Scene budgets**: < 50 MB total assets per route, < 500k triangles
  on mobile, < 2 MB compressed textures per material.
- **CDN**: serve with `Cache-Control: public, max-age=31536000,
  immutable` + filename hash. See [caching.md](caching.md).
- **CORS**: `Access-Control-Allow-Origin: <your-app>` — three.js
  texture loaders require it for `crossOrigin: 'anonymous'`.

## QoE telemetry — frame budget

Hook into the same QoE collector from
[video-streaming.md](video-streaming.md):

```ts
import { sendBeacon } from '$lib/qoe';

// inside the render loop:
const sample = { kind: 'gpu_frame', frameTimeMs: dt, drawCalls, triangles };
qoeBuffer.push(sample);
if (qoeBuffer.length >= 60) {
  sendBeacon('/api/qoe', qoeBuffer);
  qoeBuffer.length = 0;
}
```

Server-side, expose three Prometheus gauges:

```text
gpu_frame_time_p95_ms              # 95th percentile per session
gpu_dropped_frames_per_session
gpu_quality_downgrades_per_session # how often the budget enforcer fired
```

## A11y invariants (3D + canvas)

- **`<canvas>` MUST have `aria-label`** describing the scene; SR users
  hear "3D model viewer of <subject>".
- **Alternate-text fallback** (poster image + caption) must convey the
  same information for non-WebGPU and SR-only users.
- **Keyboard controls** for orbit/first-person modes — arrow keys
  rotate, +/- zoom, Home resets. `<canvas>` needs `tabindex="0"`.
- **Reduced motion** disables damping, auto-rotation, and any
  decorative camera bob.
- **No flashing** > 3 Hz (WCAG 2.3.1). Particle effects must obey.
- **Don't trap focus** on the canvas — `Esc` returns focus to the
  preceding element.

## Anti-patterns

- **Bundling three.js into shared chunks.** Threlte + three.js is ~600
  KB minified. Lazy-load the SceneViewer route; never pull into the
  app shell.
- **Skipping `probeGpu()`.** Constructing `WebGPURenderer` on a Safari
  16 device throws — your error boundary catches it, the user sees a
  red screen. Probe first.
- **Using `requestAdapter()` without `powerPreference`.** Discrete-GPU
  laptops hit the integrated GPU by default; specify
  `'high-performance'` for visualization, `'low-power'` for ambient.
- **Loading uncompressed `.png` textures.** A single 4K PNG is 16 MB
  in VRAM; KTX2/BC7 is 4 MB. The pipeline savings are 4×.
- **Skipping SHA-256 verification on assets.** A swapped `.glb` is a
  free RCE-adjacent vector — the model could carry a poisoned animation
  rig. Always verify.
- **Letting `triangleBudget` slip into the render loop without enforcement.**
  A 5M-tri user upload locks the GPU on mobile. Reject at the
  `safeParse` boundary.
- **No reduced-motion gate on auto-rotation.** Vestibular trigger.
- **Locking pixel-ratio to `window.devicePixelRatio` on retina.**
  4× pixel count = 4× fragment shader cost. Cap at 1.5–2.
- **No render-budget enforcement.** Without a downgrade path, a slow
  GPU drops to 5fps and the user thinks the app crashed.
- **`renderer.dispose()` skipped on unmount.** WebGPU resources leak
  per-route — three navigations and the tab is at 1 GB VRAM. Always
  `$effect` cleanup.
- **Sharing GPUAdapter without coordination.** LLM inference + render
  both at 100% = jank. Use the priority coordinator.
- **Using `useFrame` with heavy work synchronously.** Move physics +
  pathfinding to a Worker; the render loop reads results.
- **No CORS on texture URLs.** Three.js silently falls back to a
  black material; the user sees a void.
- **Storing user-supplied WGSL source.** Trusted-Types-bypass-explicit
  is required; even then, malicious WGSL can crash the GPU driver and
  hang the tab. Never accept user shaders.
- **Building a global `OrbitControls` damping value.** Damping must
  match `prefers-reduced-motion`; one-size-fits-all is hostile.
- **Preloading `.glb` on app shell.** The asset is route-specific.
  Use `<link rel="preload" as="fetch">` only on the scene route.
- **Catching `requestAdapter()` rejection silently.** The user needs a
  fallback experience; log the rejection reason for telemetry.
- **Multiple `<Canvas>` instances mounted simultaneously.** Each is
  a separate WebGPU device. Mount one, mount others lazily.
- **No `aria-label` on the canvas.** SR users hear "graphic" with no
  context.
- **Using TSL/WGSL when CSS would suffice.** A subtle parallax effect
  doesn't justify a GPU pipeline.
- **Hard-coded `frameTimeMs: 16` (60 Hz assumption).** ProMotion
  iPad/iPhone wants 8.3ms; old laptop wants 33ms. Read
  `screen.refreshRate` (when supported) or default to 16 + tolerance.
- **Skipping fallback adapter (`isFallbackAdapter`) check.** Fallback
  adapters use software rendering — running a complex scene at 2fps.
  Treat fallback as "no WebGPU" and use the static path.
- **Storing GPU state in `writable()`.** Use `$state` runes; the
  render loop reads via `.value` synchronously.
- **No `Cache-Control: immutable` on hashed assets.** Browser
  re-downloads on every navigation; CDN isn't enough.
- **Missing license attribution UI.** CC-BY-4.0 requires visible
  author credit. Render `config.asset.attribution` in a corner overlay.

## References

- ADRs: [0042](../adr/0042-media-player-vidstack-hls.md),
  [0044](../adr/0044-ai-on-device-transformers.md),
  [0029](../adr/0029-pwa-safe-area-tailwind4.md)
- Sibling recipes: [media-player.md](media-player.md),
  [ai-in-browser-llm.md](ai-in-browser-llm.md),
  [pwa.md](pwa.md), [image-optimization.md](image-optimization.md),
  [observability.md](observability.md),
  [caching.md](caching.md), [trusted-types.md](trusted-types.md),
  [a11y-audit-runbook.md](a11y-audit-runbook.md),
  [safe-area.md](safe-area.md)
- External: WebGPU W3C spec; WGSL spec; three.js r170+ WebGPU docs
  (`three/webgpu`); Threlte v8 docs (threlte.xyz); KTX2 / Basis
  Universal docs; gltf-transform pipeline docs; Khronos glTF 2.0
  spec; Apple USDZ documentation; WCAG 2.3.1 (three flashes); WCAG
  2.3.3 (animation from interactions)
