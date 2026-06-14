# @sveltesentio/core

> Core utilities — rune helpers, type-safe fetch, CSP hooks, error boundaries

Part of the [sveltesentio](https://github.com/golusoris/sveltesentio) composable SvelteKit framework.

## Status

✅ v0.1.0 — `./env`, `./problem` (RFC 9457), `./http`, `./id` (UUIDv7), `./csp`,
`./vite`, and clock injection have shipped.

## Requirements

**Zod v4 only.** `@sveltesentio/core` schemas require `zod@^4`
([ADR-0001](../../docs/adr/0001-zod-v4-floor.md)); **v3 is unsupported** — a v3 schema
breaks `createEnv` error reporting (`z.treeifyError`) and the `@sveltesentio/forms`
`zod4` adapter. Downstream apps on `zod@^3` must upgrade first; follow the
[Zod v3 → v4 migration guide](../../docs/migrations/zod-v3-to-v4.md).

## Installation

```bash
pnpm add @sveltesentio/core
```

See the [monorepo README](../../README.md) and [`docs/`](../../docs/) for design principles and usage.

## License

MIT © lusoris
