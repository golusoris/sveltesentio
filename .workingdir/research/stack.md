# sveltesentio — Canonical Stack

All versions verified latest stable 2026-04-17.

## Framework

| Package | Version |
|---|---|
| svelte | ^5.55.4 |
| @sveltejs/kit | ^2.57.1 |
| @sveltejs/adapter-node | ^5.5.4 |
| @sveltejs/adapter-auto | ^7.0.1 |
| @sveltejs/adapter-static | latest |
| @sveltejs/vite-plugin-svelte | ^7.0.0 |
| vite | ^8.0.8 |

## UI/Styling

| Package | Version | Note |
|---|---|---|
| tailwindcss | ^4.2.2 | |
| @tailwindcss/vite | ^4.2.2 | |
| @tailwindcss/typography | ^0.5.19 | |
| bits-ui | ^2.17.3 | headless primitive for shadcn-svelte v2 |
| shadcn-svelte | ^1.2.7 | |
| mode-watcher | ^0.5.1 | dark mode per-app |

## State/Data

| Package | Version |
|---|---|
| @tanstack/svelte-query | ^6.1.16 |
| @tanstack/svelte-virtual | ^3.13.23 |

## Forms

| Package | Version |
|---|---|
| sveltekit-superforms | ^2.30.1 |
| zod | ^4.3.6 |

## i18n

| Package | Version | Note |
|---|---|---|
| @inlang/paraglide-js | ^2.16.0 | @inlang/paraglide-sveltekit DEPRECATED — use v2 directly |

## UI Components/Utils

| Package | Version |
|---|---|
| @iconify/svelte | ^5.2.1 |
| lucide-svelte | peer dep opt-in |
| svelte-sonner | ^1.1.0 |
| layerchart | ^1.0.13 |
| @xyflow/svelte | ^1.5.2 |
| vidstack | ^0.6.15 |
| hls.js | ^1.6.15 |
| embla-carousel-svelte | ^8.6.0 |
| @formkit/auto-animate | ^0.9.0 |
| @neodrag/svelte | ^2.3.3 |
| tinykeys | ^3.0.0 |
| dompurify | ^3.4.0 |
| marked | ^18.0.0 |

## API Client

| Package | Version |
|---|---|
| openapi-typescript | latest |
| openapi-fetch | latest |

## Opt-in modules (later phases)

- @xstate/svelte — state machines
- yjs + syncedstore — real-time collab (app-subdo)
- @vite-pwa/sveltekit — PWA
- tiptap — rich text
- carta — markdown editor
- codemirror — code editor
- threlte — 3D/WebGL
- @sentry/sveltekit — error tracking
- sveltekit-sse — SSE helper
- @connectrpc/connect — ConnectRPC (in @sveltesentio/realtime)
- maplibre-gl + svelte-maplibre — maps

## Testing

| Package | Version |
|---|---|
| vitest | ^4.1.4 |
| @vitest/browser | ^4.1.4 |
| @testing-library/svelte | ^5.3.1 |
| @playwright/test | ^1.59.1 |
| axe-core | ^4.11.3 |
| @axe-core/playwright | ^4.11.1 |
| jsdom | ^29.0.2 |

## Build/DX

| Package | Version | Note |
|---|---|---|
| typescript | ^6.0.3 | |
| eslint | ^10.2.0 | flat config (eslint.config.js) |
| @typescript-eslint/eslint-plugin | ^8.58.2 | |
| @typescript-eslint/parser | ^8.58.2 | |
| eslint-plugin-svelte | ^3.17.0 | includes a11y (eslint-plugin-svelte-a11y is 404/deprecated) |
| prettier | ^3.8.3 | |
| prettier-plugin-svelte | ^3.5.1 | |
| turbo | ^2.9.6 | |
| rollup-plugin-visualizer | ^7.0.1 | |
| husky | ^9.1.7 | |
| lint-staged | ^16.4.0 | |
| @commitlint/cli | ^20.5.0 | |
| @commitlint/config-conventional | ^20.5.0 | |
| histoire | latest | component docs (D8) |

## GitHub Actions — pinned SHAs (2026-04-17)

```yaml
actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5           # v4.3.1
actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020          # v4.4.0
actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830               # v4.3.0
actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02     # v4.6.2
ossf/scorecard-action@99c09fe975337306107572b4fdf4db224cf8e2f2       # v2.4.3
github/codeql-action/init@b2f9ef845756500b97acbdaf5c1dd4e9c1d15734   # v3.35.2
github/codeql-action/analyze@b2f9ef845756500b97acbdaf5c1dd4e9c1d15734
github/codeql-action/upload-sarif@b2f9ef845756500b97acbdaf5c1dd4e9c1d15734
actions/github-script@f28e40c7f34bde8b3046d885e986cb6290c5673b      # v7.1.0
googleapis/release-please-action@5c625bfb5d1ff62eadeeb3772007f7f66fdcf071 # v4.4.1
sigstore/cosign-installer@cad07c2e89fa2edd6e2d7bab4c1aa38e53f76003   # v4.1.1
anchore/sbom-action/download-syft@e22c389904149dbc22b58101806040fa8d37a610
actions/attest-build-provenance@e8998f949152b193b063cb0ec769d69d929409be # v2.4.0
```
