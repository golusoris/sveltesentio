# @sveltesentio/ui

> shadcn-svelte presets, Tailwind 4 design tokens, per-interface-type themes

Part of the [sveltesentio](https://github.com/golusoris/sveltesentio) composable SvelteKit framework.

## Status

🟡 In progress. Landed: oklch semantic tokens (`./tokens`, ADR-0006), the
per-interface presets (`./presets`, ADR-0047) with WCAG 2.2 target-size baked in,
the headless wrapper models `./toast`, `./data`, `./cmd`, the shadcn-svelte
base components `./button`, `./input`, `./dialog` (with `/component` subpaths,
ADR-0014), plus `./theme-toggle`, `./theme-customizer`, `./font-preset`,
`./markdown`, and `./icons`.

## Sub-exports

| Import                               | What                                                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `@sveltesentio/ui/tokens`            | oklch semantic tokens (light/dark) + `themeCss()` emitter                                           |
| `@sveltesentio/ui/presets`           | `desktop` / `10foot` / `handheld` / `dashboard` presets + `presetCss()`                             |
| `@sveltesentio/ui/toast`             | `toastPreset(interfaceType)` → preset-aware `svelte-sonner` `<Toaster>` sizing/position (ADR-0016)  |
| `@sveltesentio/ui/data`              | headless `DataTable<T>` model (sort/filter/paginate reducers) + virtual-window math (ADR-0011/0024) |
| `@sveltesentio/ui/data/store`        | runes-native `createDataTable()` store                                                              |
| `@sveltesentio/ui/data/table`        | `DataTable.svelte` — WCAG 2.2 AA `role=grid` table component                                        |
| `@sveltesentio/ui/data/virtual-list` | `VirtualList.svelte` — virtualized `role=grid` list with roving focus                               |
| `@sveltesentio/ui/cmd`               | command registry (register/search/rank) + `tinykeys`-style keymap (ADR-0025)                        |
| `@sveltesentio/ui/cmd/palette`       | `CommandPalette.svelte` — accessible combobox/listbox palette                                       |

### Optional peers

The wrapper sub-surfaces declare their primitives as **optional** peers — install
only what you use: `svelte-sonner` (toast), `@tanstack/svelte-virtual` (large
virtual lists), `bits-ui` + `tinykeys` (command palette). The shipped pure models
and default components work without them.

### Example — preset-aware toast

```ts
import { Toaster, toast } from 'svelte-sonner';
import { toastPreset } from '@sveltesentio/ui/toast';

const p = toastPreset('10foot'); // top-center, 40rem, scaled padding
// <Toaster position={p.position} toastOptions={{ style: p.style }} />
```

## Installation

```bash
pnpm add @sveltesentio/ui
```

See the [monorepo README](../../README.md) and [`docs/`](../../docs/) for design principles and usage.

## License

MIT © lusoris
