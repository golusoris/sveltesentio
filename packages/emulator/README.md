# @sveltesentio/emulator

> SSR-safe EmulatorJS loader for Svelte 5 — `<Emulator>` component + platform→core map + the strict-CSP additions WASM/worker cores need.

## Status

**v0.1.0.** Loader, CSP helper and platform→core map are landed and tested. The `<Emulator>` component is a thin browser-only wrapper (untested per repo precedent — testable logic lives in `./loader` / `./cores` / `./csp`).

## Why this shape

[EmulatorJS](https://emulatorjs.org) is **not a clean npm import**. It is a self-hosted (or CDN) bundle of WASM cores (~tens of MB) plus a `loader.js` that reads a set of `window.EJS_*` globals and boots a core into a target element. This package therefore does **not** vendor EmulatorJS; it ships:

- the typed config builder that produces the `EJS_*` globals,
- an injectable-`document` script injector (so the wiring is unit-testable),
- a single audited platform-slug → core translation table,
- the exact CSP additions that let EmulatorJS run under an otherwise-strict policy.

You host the EmulatorJS data directory yourself (recommended) or point `dataPath` at a CDN.

## Install

```sh
pnpm add @sveltesentio/emulator
```

Then make the EmulatorJS data directory reachable (self-host):

```
static/emulatorjs/data/   # cores, loader.js, art, BIOS shims — from the EmulatorJS release
```

## Usage — component

```svelte
<script lang="ts">
  import Emulator from '@sveltesentio/emulator/Emulator.svelte';
</script>

<Emulator
  core="snes"
  gameUrl="/roms/zelda.sfc"
  dataPath="/emulatorjs/data/"
  gameName="A Link to the Past"
/>
```

The component is SSR-safe: it only injects the loader inside a `BROWSER` guard, and tears it down (removing the script + clearing the `EJS_*` globals) when the component is destroyed.

## Usage — headless loader

```ts
import { buildEmulatorConfig, injectEmulatorScript } from '@sveltesentio/emulator/loader';

// Pure: typed options -> the EJS_* globals.
const { globals, loaderUrl, core } = buildEmulatorConfig({
  core: 'playstation',      // human slug or raw core id
  gameUrl: '/roms/game.bin',
  biosUrl: '/bios/scph.bin',
  dataPath: '/emulatorjs/data/',
});

// Injects the loader script + globals; returns a cleanup fn.
const { cleanup } = injectEmulatorScript(
  { core: 'snes', gameUrl: '/roms/z.sfc' },
  { document, window },
);
```

`buildEmulatorConfig` throws `UnknownPlatformError` for an unrecognised platform, so a bad slug fails fast instead of 404-ing the WASM at runtime.

## Usage — platform → core

```ts
import { resolveCore, knownCores } from '@sveltesentio/emulator/cores';

resolveCore('Super Nintendo'); // 'snes'
resolveCore('Mega Drive');     // 'segaMD'
resolveCore('dreamcast');      // undefined (unsupported)
knownCores();                  // the distinct cores this package addresses
```

Slugs are matched case-insensitively after stripping non-alphanumerics, so `"sega-md"`, `"Sega MD"` and `"segamd"` all resolve identically. Covers ~25 platforms across Nintendo / Sega / Sony / NEC / SNK / Bandai / Atari / arcade.

## CSP — the load-bearing part

EmulatorJS clashes with a strict CSP: WASM compilation needs `'wasm-unsafe-eval'`, cores + workers run from `blob:`, and assets come from the data origin. Pair `emulatorCspDirectives(...)` with `@sveltesentio/core`'s `strictCsp` via the merge helper:

```ts
import { strictCsp, serialiseCsp } from '@sveltesentio/core/csp';
import { emulatorCspDirectives, mergeCspDirectives } from '@sveltesentio/emulator/csp';

const base = strictCsp({ nonce });
const policy = mergeCspDirectives(
  base,
  emulatorCspDirectives({ dataBaseUrl: 'https://roms.example.com/data/' }),
);

response.headers.set('Content-Security-Policy', serialiseCsp(policy));
```

`mergeCspDirectives` unions source lists per directive (de-duplicated, order-preserving) and leaves boolean/string base directives (e.g. `upgrade-insecure-requests`) untouched. What gets added:

| Directive | Added sources | Reason |
|---|---|---|
| `script-src` | `'self' blob: 'wasm-unsafe-eval'` | WASM core compilation + blob bootstrap |
| `worker-src` | `'self' blob:` | EmulatorJS Web Workers |
| `child-src` | `'self' blob:` | worker fallback for older engines |
| `connect-src` | `'self'` + data origin | fetch cores / ROM / BIOS |
| `img-src` | `'self' blob: data:` + data origin | canvas + box art |
| `media-src` | `'self' blob:` + data origin | audio |

For engines that predate `'wasm-unsafe-eval'`, pass `{ wasmEvalFallback: true }` to substitute the broad `'unsafe-eval'` — this materially weakens the policy, so only enable it when you must.

## Out of scope

ROM-library browsing, save-state/achievement data shapes, and netplay session orchestration are app-specific game-domain logic and live downstream — this package is only the emulator-core wrapper + CSP story.

## Related

- [docs/principles.md](../../docs/principles.md) §2.2 — OWASP ASVS L2 / CSP.
- `@sveltesentio/core/csp` — `strictCsp` / `serialiseCsp` this composes with.
