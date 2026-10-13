# @sveltesentio/emulator — AGENTS.md

> SSR-safe EmulatorJS loader + platform→core map + strict-CSP additions. Filed from issue #72 (Revenge retro-emulation adoption audit). EmulatorJS does NOT live in `@sveltesentio/media` — see `media/AGENTS.md` (D113): ~tens-of-MB cores bloat every media consumer -> emulator = own package.

## Landed (v0.1.0)

| Sub-export          | Contents                                                                                                                                                                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.`                 | Barrel re-export of everything below                                                                                                                                                                                                                      |
| `./cores`           | `resolveCore(slug)` / `knownCores()` / `normaliseSlug()` / `PLATFORM_CORES` — audited platform-slug → EmulatorJS core map (~25 platforms). PURE, unit-tested                                                                                              |
| `./loader`          | `buildEmulatorConfig(opts)` → `EJS_*` globals (pure); `injectEmulatorScript(opts, {document, window})` → sets globals + injects `loader.js`, returns `cleanup()`. Injectable DOM -> unit-testable in Node. `UnknownPlatformError` for bad slugs           |
| `./csp`             | `emulatorCspDirectives(opts)` → CSP additions EmulatorJS needs (WASM `'wasm-unsafe-eval'`, `blob:` script/worker/child, data-origin connect/img/media); `mergeCspDirectives(base, additions)` unions onto strict base; `originOf(url)`. PURE, unit-tested |
| `./Emulator.svelte` | Thin Svelte 5 component: `BROWSER`-guarded `injectEmulatorScript` into mount `<div>`, `cleanup` on destroy. UNTESTED (per repo precedent — logic in `./loader`)                                                                                           |

Ships `src/runes-ambient.d.ts` so plain `tsc --noEmit` typechecks `.svelte`-adjacent code; keep while package `typecheck` script = plain tsc (`pnpm check:svelte` covers `.svelte` files only).

## Scope

This package:

- Translates human platform slugs → EmulatorJS core ids through 1 audited table.
- Builds `window.EJS_*` config object EmulatorJS reads, with typed surface.
- Injects self-hosted/CDN `loader.js` SSR-safely; tears down cleanly.
- Provides CSP additions letting EmulatorJS run under `@sveltesentio/core` `strictCsp`.

This package does **not**:

- Vendor EmulatorJS — self-hosted/CDN bundle, not npm module. Consumers host data directory or point `dataPath` at CDN.
- Own ROM-library browsing, save-state/achievement data shapes, netplay orchestration — app-specific game-domain logic, downstream (issue #72 explicitly excludes these).
- Live in `@sveltesentio/media` — cores too heavy to bundle into every media consumer (D113).
- Depend on `@sveltesentio/core` at runtime — `./csp` mirrors `CspDirectives` structurally -> composes with `strictCsp`/`serialiseCsp` without hard dep or non-hermetic tests.

## Invariants

- **No clean import.** EmulatorJS boots from `window.EJS_*` globals + `loader.js`; never `import 'emulatorjs'`. Tests must not assume module.
- **DOM injected, never imported.** `injectEmulatorScript` takes `{document, window}` -> testable in Node. `.svelte` component = only place real `document`/`window` read, behind `BROWSER`.
- **Bad slug fails fast.** `buildEmulatorConfig` throws `UnknownPlatformError` rather than booting EmulatorJS with garbage core that 404s WASM.
- **CSP additions merge-only.** `emulatorCspDirectives` returns deltas only (no `default-src`/`object-src`); always combine via `mergeCspDirectives` onto strict base. Source lists de-duplicated.
- **`'wasm-unsafe-eval'` by default, `'unsafe-eval'` only on opt-in.** Narrow grant = default; `wasmEvalFallback` widens grant for legacy engines; must be conscious choice.
- **Cleanup reverts everything.** Returned cleanup removes script + deletes exactly `EJS_*` keys it set — no leak across re-mounts; re-mount removes prior loader script first.

## Test policy

- Unit: `./cores`, `./csp`, `./loader` against fake `document`/`window`. No real DOM, no network, no EmulatorJS bundle.
- `.svelte` component untested (vitest lacks Svelte plugin here; precedent: collab/realtime/charts ship components untested with logic tested in `.ts`).
- 39 tests across cores/csp/loader. tsc + eslint clean.

## Common tasks

| Task       | Command                                          |
| ---------- | ------------------------------------------------ |
| Typecheck  | `pnpm --filter @sveltesentio/emulator typecheck` |
| Lint       | `pnpm --filter @sveltesentio/emulator lint`      |
| Unit tests | `pnpm --filter @sveltesentio/emulator test`      |

## Related

- Issue #72 — Revenge retro-emulation adoption audit (this package's charter).
- `@sveltesentio/core/csp` — `strictCsp` / `serialiseCsp` this composes with.
- `packages/media/AGENTS.md` — D113: why EmulatorJS is NOT in media.
- [docs/principles.md](../../docs/principles.md) §2.2 — OWASP ASVS L2 / CSP.
