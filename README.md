# sveltesentio

[![CI](https://img.shields.io/github/actions/workflow/status/golusoris/sveltesentio/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/golusoris/sveltesentio/actions/workflows/ci.yml)
[![CodeQL](https://img.shields.io/github/actions/workflow/status/golusoris/sveltesentio/codeql.yml?branch=main&style=flat-square&label=CodeQL)](https://github.com/golusoris/sveltesentio/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://img.shields.io/ossf-scorecard/github.com/golusoris/sveltesentio?style=flat-square&label=Scorecard)](https://securityscorecards.dev/viewer/?uri=github.com/golusoris/sveltesentio)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Svelte 5](https://img.shields.io/badge/Svelte-5-FF3E00?style=flat-square&logo=svelte&logoColor=white)](https://svelte.dev)
[![pnpm](https://img.shields.io/badge/pnpm-monorepo-F69220?style=flat-square&logo=pnpm&logoColor=white)](https://pnpm.io)
[![Sponsor](https://img.shields.io/github/sponsors/lusoris?style=flat-square&logo=github&label=Sponsor)](https://github.com/sponsors/lusoris)

> Composable SvelteKit framework — opt-in modules, Svelte 5 runes, production-grade.

The direct frontend counterpart to [golusoris](https://github.com/golusoris/golusoris).
Apps install only what they need from `@sveltesentio/*`. Philosophy first, code second.

## Packages

| Package | Version | Description |
| --- | --- | --- |
| [`@sveltesentio/core`](packages/core) | [![npm](https://img.shields.io/npm/v/@sveltesentio/core?style=flat-square)](https://www.npmjs.com/package/@sveltesentio/core) | Vite plugin, env validation, error types, UUIDv7, clock, logger |
| [`@sveltesentio/ui`](packages/ui) | [![npm](https://img.shields.io/npm/v/@sveltesentio/ui?style=flat-square)](https://www.npmjs.com/package/@sveltesentio/ui) | shadcn-svelte wrapper, Tailwind 4 tokens, per-interface presets |
| [`@sveltesentio/query`](packages/query) | [![npm](https://img.shields.io/npm/v/@sveltesentio/query?style=flat-square)](https://www.npmjs.com/package/@sveltesentio/query) | TanStack Query v6, openapi-fetch client, SSR hydration |
| [`@sveltesentio/forms`](packages/forms) | [![npm](https://img.shields.io/npm/v/@sveltesentio/forms?style=flat-square)](https://www.npmjs.com/package/@sveltesentio/forms) | Superforms v2 + Zod v4, logic helpers + opt-in field components |
| [`@sveltesentio/i18n`](packages/i18n) | [![npm](https://img.shields.io/npm/v/@sveltesentio/i18n?style=flat-square)](https://www.npmjs.com/package/@sveltesentio/i18n) | Paraglide JS v2 — locale routing, RTL, message utilities |
| [`@sveltesentio/auth`](packages/auth) | [![npm](https://img.shields.io/npm/v/@sveltesentio/auth?style=flat-square)](https://www.npmjs.com/package/@sveltesentio/auth) | Cookie session, OIDC/PKCE, role guards, JWT decode |
| [`@sveltesentio/realtime`](packages/realtime) | [![npm](https://img.shields.io/npm/v/@sveltesentio/realtime?style=flat-square)](https://www.npmjs.com/package/@sveltesentio/realtime) | SSE (sveltekit-sse), WebSocket, ConnectRPC adapters |
| [`@sveltesentio/flow`](packages/flow) | [![npm](https://img.shields.io/npm/v/@sveltesentio/flow?style=flat-square)](https://www.npmjs.com/package/@sveltesentio/flow) | @xyflow/svelte wrappers — nodes, canvas, inspector, mini-map |
| [`@sveltesentio/media`](packages/media) | [![npm](https://img.shields.io/npm/v/@sveltesentio/media?style=flat-square)](https://www.npmjs.com/package/@sveltesentio/media) | vidstack + HLS.js + embla-carousel, artwork grid, playback bar |
| [`@sveltesentio/charts`](packages/charts) | [![npm](https://img.shields.io/npm/v/@sveltesentio/charts?style=flat-square)](https://www.npmjs.com/package/@sveltesentio/charts) | layerchart wrappers — SSR-safe, real-time, semantic colors |
| [`@sveltesentio/ai`](packages/ai) | [![npm](https://img.shields.io/npm/v/@sveltesentio/ai?style=flat-square)](https://www.npmjs.com/package/@sveltesentio/ai) | LLM streaming chat UI, edge AI (Transformers.js/WebGPU), semantic search |
| [`@sveltesentio/files`](packages/files) | [![npm](https://img.shields.io/npm/v/@sveltesentio/files?style=flat-square)](https://www.npmjs.com/package/@sveltesentio/files) | Virtual-scrolled file manager, drag-drop, multi-select library browser |

## Design system

- **Colors** — oklch only. No hex, rgb, or hsl anywhere in the framework.
- **Spacing** — 8pt grid (`--space-1` → `--space-24`)
- **Interface presets** — media server, dashboard, webapp, mobile PWA, 10-foot TV, flow editor, file manager
- **Standards** — WCAG 2.2 AA · OWASP ASVS L2 · SLSA L3 · Svelte 5 runes-first
- **Cross-platform** — Chrome 120+, Firefox 121+, Safari 17.2+. Zero native client apps.

See [`docs/principles.md`](docs/principles.md) and [`docs/ux-principles.md`](docs/ux-principles.md).

## Development

```bash
make setup   # pnpm install + husky init
make dev     # turbo dev (all packages watch)
make ci      # lint + typecheck + test + build + audit
make fmt     # prettier format
```

Requires Node ≥ 22 and pnpm ≥ 10.

## Contributing

See [`AGENTS.md`](AGENTS.md) for repo layout, conventions, and the do/don't list.  
All PRs must pass: `0 eslint · 0 type errors · 0 audit vulns · axe-clean`.

## Sponsor

If sveltesentio saves you time, consider [sponsoring lusoris](https://github.com/sponsors/lusoris) ❤️

## License

MIT © [lusoris](https://github.com/lusoris)
