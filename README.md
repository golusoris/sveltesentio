# sveltesentio

> Composable SvelteKit framework — opt-in modules, Svelte 5 runes, production-grade.

The direct frontend counterpart to [golusoris](https://github.com/golusoris/golusoris).
Apps install only what they need from `@sveltesentio/*`. Philosophy first, code second.

## Packages

| Package | Description |
|---|---|
| `@sveltesentio/core` | Core utilities — rune helpers, type-safe fetch, CSP hooks, error boundaries |
| `@sveltesentio/ui` | shadcn-svelte presets, Tailwind 4 tokens, per-interface-type themes |
| `@sveltesentio/query` | TanStack Query v6 wrappers — SSR hydration, optimistic updates |
| `@sveltesentio/forms` | Superforms v2 + Zod v4 patterns, field components |
| `@sveltesentio/i18n` | Paraglide JS v2 — locale routing, RTL, message utilities |
| `@sveltesentio/auth` | SvelteKit auth patterns — session hooks, CSRF, role guards |
| `@sveltesentio/realtime` | SSE + WebSocket + ConnectRPC transport adapters |
| `@sveltesentio/flow` | @xyflow/svelte wrappers — node templates, canvas utilities |
| `@sveltesentio/media` | vidstack + HLS.js + embla-carousel for media server UIs |
| `@sveltesentio/charts` | layerchart wrappers — SSR-safe, real-time data |
| `@sveltesentio/ai` | LLM streaming chat UI, edge AI (Transformers.js/WebGPU), semantic search |

## Design system

- **Colors**: oklch only — no hex, no rgb, no hsl
- **Spacing**: 8pt grid (`--space-1` → `--space-24`)
- **Interface types**: 10-foot, media server, dashboard, flow editor, file manager, web app, mobile PWA
- **Standards**: WCAG 2.2 AA, OWASP ASVS L2, SLSA L3, Svelte 5 runes-first

See [`docs/principles.md`](docs/principles.md) and [`docs/ux-principles.md`](docs/ux-principles.md).

## Development

```bash
make setup   # pnpm install + husky init
make dev     # turbo dev (all packages watch)
make ci      # lint + typecheck + test + build
```

Requires Node 22 LTS and pnpm 10+.

## License

MIT © lusoris
