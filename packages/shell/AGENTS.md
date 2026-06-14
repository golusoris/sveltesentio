# @sveltesentio/shell — AGENTS.md

> Device-class shell. Locked through [ADR-0027](../../docs/adr/0027-custom-focus-graph-10foot.md) (focus graph) + [ADR-0028](../../docs/adr/0028-vite-pwa-sveltekit.md) (PWA) + [ADR-0029](../../docs/adr/0029-tailwind4-safe-area-utilities.md) (safe-area).

## Scope

| Sub-export | Contents | Status |
|---|---|---|
| `./device-class` | `classifyDevice()` → `desktop` / `handheld` / `10foot`; SSR-safe `readDeviceSignals()` | v0.1.0 |
| `./dpad` | `computeNextFocus()` + key/gamepad mappers + `dpadNavigation` action | v0.1.0 |
| `./safe-area` | `safeAreaInset()` / `cssVars()` / logical-property padding helpers | v0.1.0 |
| `./pwa` | `registerSW()` over the optional `virtual:pwa-register` module | v0.1.0 |

This package:

- Owns the **device-class classification** — one pure function mapping pointer + viewport + TV hint to a ui interface preset.
- Implements the **D-pad / Gamepad focus graph** — pure nearest-neighbour geometry, driven by a thin `use:` action from keyboard + Gamepad API.
- Ships **safe-area helpers** — CSS-var emitters + logical-property declarations (no runtime cost).
- Wires the **optional PWA layer** via `virtual:pwa-register` — registration + update prompt callbacks.

This package does **not**:

- Ship visual components — `@sveltesentio/ui` does. Shell is structural/logic only.
- Own the Tailwind preset / `@utility` defs — `@sveltesentio/ui/preset` does (ADR-0029). Shell emits the matching CSS vars.
- Hard-depend on `@vite-pwa/sveltekit` — it stays an **optional** peer; `pwa.ts` declares its own option type and lazily imports the virtual module.
- Load Serwist — `@serwist/sveltekit` does not exist on npm (2026-04-17). Re-audit in v0.3.

## Invariants

- **Interface type is declared once, at the root.** `classifyDevice` runs at `<DeviceClassRoot>`; components read the resulting preset — no per-component re-classification.
- **`classifyDevice` is pure + total.** Deterministic over `{ pointerCoarse, viewportWidth, tv }`; precedence is `tv` → large-coarse → coarse → narrow-fine → desktop. Tested exhaustively.
- **Focus graph fails loud.** `computeNextFocus` returns `null` when no neighbour exists in the move direction — never wraps silently.
- **D-pad accepts both input sources.** Keyboard arrows **and** Gamepad API (standard D-pad buttons 12–15 + left-stick past a deadzone). One cell per discrete press; no hold-to-repeat (reduced-motion-friendly).
- **No physical-dimension CSS.** Safe-area helpers emit `padding-block-*` / `padding-inline-*` only — RTL-safe. `padding-left`/`margin-right` are forbidden.
- **PWA registration is SSR-safe + optional.** `registerSW` no-ops without `window`; a missing PWA plugin logs a warning, never throws at module load.

## Layout

| File | Role | Coverage |
|---|---|---|
| `src/device-class.ts` | Pure classification + SSR-safe signal read | unit-tested |
| `src/dpad.ts` | Pure focus geometry + key/gamepad/axis mappers + `resolveNextFocus` | unit-tested |
| `src/dpad-action.ts` | `dpadNavigation` Svelte `use:` action (DOM/timer-bound) | excluded — delegates to tested core |
| `src/dpad-index.ts` | `./dpad` barrel (pure + action) | excluded (barrel) |
| `src/safe-area.ts` | CSS-var emitters + logical-property helpers | unit-tested |
| `src/pwa.ts` | Lazy `registerSW` wrapper | excluded (DOM/dynamic-import) |
| `src/virtual-pwa.d.ts` | Ambient stub for `virtual:pwa-register` | n/a |
| `src/index.ts` | Root barrel | excluded (barrel) |

## Test policy

- Unit (Vitest, node env): pure classification + focus geometry + input mappers + safe-area emitters. 34 tests.
- DOM/timer/dynamic-import code (`dpad-action.ts`, `pwa.ts`) is seam-injected and excluded from coverage — the logic it delegates to is fully covered.
- Integration (planned): Playwright a11y sweep + arrow-key/gamepad navigation under each interface type.
- Coverage ≥ 85% on the pure surface.

## Common tasks

| Task | Command |
|---|---|
| Typecheck | `pnpm --filter @sveltesentio/shell typecheck` |
| Lint | `pnpm --filter @sveltesentio/shell lint` |
| Unit tests | `pnpm --filter @sveltesentio/shell test` |

## Related

- [ADR-0027](../../docs/adr/0027-custom-focus-graph-10foot.md) — custom focus-graph D-pad router.
- [ADR-0028](../../docs/adr/0028-vite-pwa-sveltekit.md) — PWA via `@vite-pwa/sveltekit`.
- [ADR-0029](../../docs/adr/0029-tailwind4-safe-area-utilities.md) — Tailwind 4 safe-area helpers + `viewport-fit=cover`.
- [docs/ux-principles.md](../../docs/ux-principles.md) — interface-type UX guardrails.
