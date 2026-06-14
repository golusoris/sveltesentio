# sveltesentio

> Composable SvelteKit framework — opt-in modules, Svelte 5 runes, production-grade.

The direct frontend counterpart to [golusoris](https://github.com/golusoris/golusoris).
Apps install only what they need from `@sveltesentio/*`. Philosophy first, code second.

## Packages

| Package | Description |
|---|---|
| `@sveltesentio/core` | Core utilities — env schema, RFC 9457 parser, id/clock injection, CSP helpers, vite plugin |
| `@sveltesentio/ui` | shadcn-svelte CLI wrapper, Tailwind 4 tokens, per-interface-type presets (desktop / 10-foot / handheld / dashboard) |
| `@sveltesentio/query` | TanStack Query v6 wrappers — SSR hydration, optimistic updates, RFC 9457 retry |
| `@sveltesentio/forms` | Superforms v2 + Zod v4 patterns, field components, RFC 9457 → field-error mapping |
| `@sveltesentio/i18n` | Paraglide v2 (`paraglideVitePlugin`) — URL + cookie + baseLocale strategy, RTL via logical properties |
| `@sveltesentio/auth` | Custom OIDC against Golusoris, `@simplewebauthn/browser` passkeys, HttpOnly cookie sessions, MFA UI |
| `@sveltesentio/realtime` | Native SSE (`useSSE`) + ConnectRPC streaming (`useConnectStream`); Yjs lives in `collab` |
| `@sveltesentio/flow` | `@xyflow/svelte` wrappers — node palette, elkjs layout, DAG helpers |
| `@sveltesentio/media` | `vidstack@next` + `hls.js`, embla carousel via shadcn, captions-required by default |
| `@sveltesentio/charts` | LayerChart v2-next via shadcn Chart + uPlot escape hatch + a11y wrapper |
| `@sveltesentio/ai` | LLM streaming (server-proxy-only SDKs), `@huggingface/transformers` edge AI, EU AI Act audit hook |
| `@sveltesentio/ipc-sockmap` | Tier 3 kernel-bypass IPC client (eBPF SK_MSG sockhash; Linux + kernel ≥5.10; blocked on golusoris#27) |
| `@sveltesentio/testing` | `testClock({ now })`, a11y harness, Superforms + Query fixtures |

## Design system

- **Colors**: oklch only — no hex, no rgb, no hsl
- **Spacing**: 8pt grid (`--space-1` → `--space-24`)
- **Interface types**: desktop, 10-foot, handheld, dashboard (see [ADR-0047](docs/adr/0047-per-interface-presets.md))
- **Standards**: WCAG 2.2 AA, OWASP ASVS L2, SLSA L3, EU AI Act Art. 12, Svelte 5 runes-first

See [`docs/principles.md`](docs/principles.md) and [`docs/ux-principles.md`](docs/ux-principles.md).

## Development

```bash
make setup   # pnpm install + husky init
make dev     # turbo dev (all packages watch)
make ci      # lint + typecheck + test + build
```

Requires Node 24+ (see [ADR-0021](docs/adr/0021-node-24-floor.md)) and pnpm 10+.

## License

MIT © lusoris
