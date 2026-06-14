# @sveltesentio/shell

> Device-class shell — PWA (`@vite-pwa/sveltekit`) + Tailwind 4 safe-area + D-pad focus graph.

## Status

**Scaffold.** Public API unimplemented. Locked through [ADR-0028](../../docs/adr/0028-vite-pwa-sveltekit.md) + [ADR-0047](../../docs/adr/0047-per-interface-presets.md).

## Planned sub-exports

| Sub-export | Contents |
|---|---|
| `./pwa` | `registerSW` wrapper + update-prompt component over `@vite-pwa/sveltekit` |
| `./layout` | `<SafeArea />`, `<DeviceClassRoot />`, container queries for desktop / 10-foot / handheld / dashboard |
| `./dpad` | Focus graph + `<FocusCell />` directive for 10-foot + handheld navigation |

## Planned surface

```svelte
<script>
  import { DeviceClassRoot, SafeArea } from '@sveltesentio/shell/layout';
  import { FocusCell } from '@sveltesentio/shell/dpad';
  import { registerSW } from '@sveltesentio/shell/pwa';

  registerSW({ immediate: true });
</script>

<DeviceClassRoot>
  <SafeArea>
    <FocusCell id="home">…</FocusCell>
  </SafeArea>
</DeviceClassRoot>
```

## Design notes

- **PWA** goes through `@vite-pwa/sveltekit@^1.1` — no Serwist until `@serwist/sveltekit` ships (re-audit in v0.3).
- **Interface types** — desktop / 10-foot / handheld / dashboard per [ADR-0047](../../docs/adr/0047-per-interface-presets.md). Tailwind preset swap + container queries, not runtime branching.
- **Safe-area** uses Tailwind 4 logical-property tokens — `padding-inline-start: env(safe-area-inset-left)` etc. No iOS-specific branching.
- **D-pad** focus graph is declarative — cells register neighbours; nav engine walks the graph on arrow-key events.

## Related ADRs

- [ADR-0028](../../docs/adr/0028-vite-pwa-sveltekit.md) — PWA layer lock.
- [ADR-0047](../../docs/adr/0047-per-interface-presets.md) — per-interface-type presets.
