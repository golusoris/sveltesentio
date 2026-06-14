# @sveltesentio/emulator — AGENTS.md

> SSR-safe EmulatorJS loader + platform→core map + strict-CSP additions. Filed from issue #72 (Revenge retro-emulation adoption audit). EmulatorJS does NOT live in `@sveltesentio/media` — see `media/AGENTS.md` (D113): the ~tens-of-MB cores would bloat every media consumer, so the emulator is its own package.

## Landed (v0.1.0)

| Sub-export | Contents |
|---|---|
| `.` | Barrel re-export of everything below |
| `./cores` | `resolveCore(slug)` / `knownCores()` / `normaliseSlug()` / `PLATFORM_CORES` — audited platform-slug → EmulatorJS core map (~25 platforms). PURE, unit-tested |
| `./loader` | `buildEmulatorConfig(opts)` → the `EJS_*` globals (pure); `injectEmulatorScript(opts, {document, window})` → sets globals + injects `loader.js`, returns `cleanup()`. Injectable DOM so it is unit-testable in Node. `UnknownPlatformError` for bad slugs |
| `./csp` | `emulatorCspDirectives(opts)` → the CSP additions EmulatorJS needs (WASM `'wasm-unsafe-eval'`, `blob:` script/worker/child, data-origin connect/img/media); `mergeCspDirectives(base, additions)` unions onto a strict base; `originOf(url)`. PURE, unit-tested |
| `./Emulator.svelte` | Thin Svelte 5 component: `BROWSER`-guarded `injectEmulatorScript` into a mount `<div>`, `cleanup` on destroy. UNTESTED (per repo precedent — logic is in `./loader`) |

Ships `src/runes-ambient.d.ts` so plain `tsc --noEmit` typechecks `.svelte`-adjacent code until the monorepo adopts `svelte-check` globally.

## Scope

This package:

- Translates human platform slugs → EmulatorJS core ids through one audited table.
- Builds the `window.EJS_*` config object EmulatorJS reads, with a typed surface.
- Injects the self-hosted/CDN `loader.js` SSR-safely and tears it down cleanly.
- Provides the CSP additions that let EmulatorJS run under `@sveltesentio/core`'s `strictCsp`.

This package does **not**:

- Vendor EmulatorJS — it is a self-hosted/CDN bundle, not an npm module. Consumers host the data directory or point `dataPath` at a CDN.
- Own ROM-library browsing, save-state/achievement data shapes, or netplay orchestration — app-specific game-domain logic, downstream (issue #72 explicitly excludes these).
- Live in `@sveltesentio/media` — cores are too heavy to bundle into every media consumer (D113).
- Depend on `@sveltesentio/core` at runtime — `./csp` mirrors `CspDirectives` structurally so it composes with `strictCsp`/`serialiseCsp` without a hard dep or non-hermetic tests.

## Invariants

- **No clean import.** EmulatorJS boots from `window.EJS_*` globals + `loader.js`; we never `import 'emulatorjs'`. Tests must not assume a module.
- **DOM is injected, never imported.** `injectEmulatorScript` takes `{document, window}` so it is testable in Node. The `.svelte` component is the only place real `document`/`window` are read, behind `BROWSER`.
- **Bad slug fails fast.** `buildEmulatorConfig` throws `UnknownPlatformError` rather than booting EmulatorJS with a garbage core that 404s the WASM.
- **CSP additions are merge-only.** `emulatorCspDirectives` returns just the deltas (no `default-src`/`object-src`); always combine via `mergeCspDirectives` onto a strict base. Source lists are de-duplicated.
- **`'wasm-unsafe-eval'` by default, `'unsafe-eval'` only on opt-in.** The narrow grant is the default; `wasmEvalFallback` widens it for legacy engines and must be a conscious choice.
- **Cleanup reverts everything.** The returned cleanup removes the script and deletes exactly the `EJS_*` keys it set — no leak across re-mounts; re-mount removes a prior loader script first.

## Test policy

- Unit: `./cores`, `./csp`, `./loader` against a fake `document`/`window`. No real DOM, no network, no EmulatorJS bundle.
- `.svelte` component is untested (vitest lacks the Svelte plugin here; precedent: collab/realtime/charts ship components untested with logic tested in `.ts`).
- 39 tests across cores/csp/loader. tsc + eslint clean.

## Common tasks

| Task | Command |
|---|---|
| Typecheck | `pnpm --filter @sveltesentio/emulator typecheck` |
| Lint | `pnpm --filter @sveltesentio/emulator lint` |
| Unit tests | `pnpm --filter @sveltesentio/emulator test` |

## Related

- Issue #72 — Revenge retro-emulation adoption audit (this package's charter).
- `@sveltesentio/core/csp` — `strictCsp` / `serialiseCsp` this composes with.
- `packages/media/AGENTS.md` — D113: why EmulatorJS is NOT in media.
- [docs/principles.md](../../docs/principles.md) §2.2 — OWASP ASVS L2 / CSP.
