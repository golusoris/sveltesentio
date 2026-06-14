# @sveltesentio/ui

> shadcn-svelte presets, Tailwind 4 design tokens, per-interface-type themes

Part of the [sveltesentio](https://github.com/golusoris/sveltesentio) composable SvelteKit framework.

## Status

🟡 In progress. Landed: oklch semantic tokens (`./tokens`, ADR-0006) and the
per-interface presets (`./presets`, ADR-0047) with WCAG 2.2 target-size baked in.
Follow-through: shadcn-svelte component wrappers, `ui/data`, `ui/cmd`, `ui/toast`.

## Sub-exports

| Import | What |
|---|---|
| `@sveltesentio/ui/tokens` | oklch semantic tokens (light/dark) + `themeCss()` emitter |
| `@sveltesentio/ui/presets` | `desktop` / `10foot` / `handheld` / `dashboard` presets + `presetCss()` |

## Installation

```bash
pnpm add @sveltesentio/ui
```

See the [monorepo README](../../README.md) and [`docs/`](../../docs/) for design principles and usage.

## License

MIT © lusoris
