# @sveltesentio/shell — AGENTS.md

> Device-class shell. Locked through [ADR-0028](../../docs/adr/0028-vite-pwa-sveltekit.md) (PWA) + [ADR-0047](../../docs/adr/0047-per-interface-presets.md) (interface-type presets).

## Scope

| Sub-export | Contents | Status |
|---|---|---|
| `./pwa` | `registerSW` wrapper + update-prompt over `@vite-pwa/sveltekit@^1.1` | scaffold |
| `./layout` | `<SafeArea />`, `<DeviceClassRoot />`, per-interface container queries | scaffold |
| `./dpad` | Focus graph + `<FocusCell />` directive for 10-foot + handheld | scaffold |

This package:

- Owns the **device-class layout primitives** — safe-area, root container, preset selection.
- Wires the **PWA layer** via `@vite-pwa/sveltekit` — service worker registration + update prompts.
- Implements the **D-pad focus graph** for 10-foot + handheld interface types.

This package does **not**:

- Ship visual components — `@sveltesentio/ui` does. Shell is structural only.
- Own the Tailwind preset — `@sveltesentio/ui/preset-*` does. Shell consumes.
- Load Serwist — `@serwist/sveltekit` does not exist on npm (2026-04-17). Re-audit in v0.3.

## Invariants

- **Interface type is declared at the root, not re-decided per component.** `<DeviceClassRoot>` sets the class once (desktop / 10-foot / handheld / dashboard); layout queries read it. No runtime branching inside components.
- **Safe-area uses logical properties.** `padding-inline-start` + `env(safe-area-inset-*)` — no iOS-specific CSS, no physical `padding-left`.
- **D-pad is opt-in per cell.** `<FocusCell id="x" up="y" down="z" />` — missing cells break the graph deliberately (fails loud, not silent).
- **PWA registration is SSR-safe.** `registerSW` guards with `BROWSER` from `esm-env`. Never run the SW in Node.
- **No physical-dimension CSS.** `margin-left`, `padding-right`, etc. are forbidden — RTL breaks immediately.

## Test policy

- Unit: layout primitives against JSDOM. D-pad focus graph tested with synthetic keydown events on a fixture tree.
- Integration (planned): Playwright a11y sweep under each interface type (desktop + 10-foot + handheld).
- Coverage ≥ 70%.

## Common tasks

| Task | Command |
|---|---|
| Typecheck | `pnpm --filter @sveltesentio/shell typecheck` |
| Unit tests | `pnpm --filter @sveltesentio/shell test` |

## Related

- [ADR-0028](../../docs/adr/0028-vite-pwa-sveltekit.md) — PWA via `@vite-pwa/sveltekit`.
- [ADR-0047](../../docs/adr/0047-per-interface-presets.md) — per-interface-type presets (desktop / 10-foot / handheld / dashboard).
- [docs/compose/pwa.md](../../docs/compose/pwa.md) — manifest + update prompts (pending).
- [docs/ux-principles.md](../../docs/ux-principles.md) — interface-type UX guardrails.
