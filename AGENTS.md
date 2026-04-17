# AGENTS.md — sveltesentio

Agent orientation guide for Claude Code and other AI tools.

## Repo layout

```
sveltesentio/
├── packages/                   @sveltesentio/* publishable modules
│   ├── core/                   env, errors, id, clock, base vite config
│   ├── ui/                     shadcn-svelte CLI wrapper + Tailwind 4 preset + design tokens
│   ├── query/                  TanStack Query wrappers for SvelteKit (load helpers, optimistic)
│   ├── forms/                  Superforms + Zod patterns, field components, error mapping
│   ├── i18n/                   Paraglide-js v2 config, locale middleware
│   ├── auth/                   OIDC/session client, token refresh, permission stores
│   ├── realtime/               SSE + WebSocket + ConnectRPC transport adapter
│   ├── flow/                   @xyflow/svelte wrappers (node editors, DAG)
│   ├── media/                  Vidstack + HLS.js + embla-carousel wrappers
│   ├── charts/                 Layerchart wrappers + dashboard presets
│   └── ai/                     LLM chat components + edge AI (Transformers.js) + semantic search
├── apps/                       consuming applications (for integration tests + docs site)
├── docs/
│   ├── principles.md           §2 coding contract (Power of 10, OWASP, WCAG, etc.)
│   └── ux-principles.md        §3 UI/UX design rules per interface type
├── .claude/
│   ├── settings.json           hooks configuration
│   └── skills/                 Claude Code skills
├── .github/
│   ├── workflows/
│   │   ├── ci.yml              main CI (lint, typecheck, test, build, audit)
│   │   ├── ci-sveltekit.yml    REUSABLE — downstream apps call this
│   │   ├── release-please.yml  automated versioning + CHANGELOG
│   │   ├── release-sveltekit.yml REUSABLE — downstream app releases
│   │   ├── scorecard.yml       OSS Scorecard security analysis
│   │   ├── codeql.yml          CodeQL JS/TS analysis
│   │   ├── auto-assign.yml     assign @lusoris on issues/PRs
│   │   └── dependabot.yml      weekly dep updates
├── .workingdir/
│   ├── PLAN.md                 full multi-phase roadmap
│   ├── STATE.md                current status + decision log
│   └── research/               ecosystem audit + locked decisions
├── CLAUDE.md                   Claude Code guide (read this)
├── AGENTS.md                   this file
├── Makefile                    make setup | dev | build | ci | clean
├── package.json                root workspace manifest
├── pnpm-workspace.yaml         workspace packages
├── turbo.json                  turborepo task pipeline
├── tsconfig.base.json          shared TypeScript strict config
├── eslint.config.js            flat ESLint config (TS + Svelte + a11y + prettier)
├── prettier.config.js          Prettier config with svelte plugin
├── commitlint.config.js        Conventional Commits enforcement
├── release-please-config.json  release-please package manifest
└── .release-please-manifest.json version manifest
```

## Package purpose table

| Package | Phase | Key dependencies | What it provides |
|---|---|---|---|
| `@sveltesentio/core` | 2 | vite, zod | vite plugin, env schema, error types, id/clock utils, base tsconfig |
| `@sveltesentio/ui` | 3 | shadcn-svelte, bits-ui, tailwindcss, mode-watcher | CLI wrapper for shadcn, Tailwind 4 preset, design tokens per interface type |
| `@sveltesentio/query` | 4 | @tanstack/svelte-query | SvelteKit load helpers, optimistic updates, SSR hydration |
| `@sveltesentio/forms` | 5 | sveltekit-superforms, zod | Form patterns, field components, action helpers, error mapping |
| `@sveltesentio/i18n` | 6 | @inlang/paraglide-js | Locale detection, message helpers, SvelteKit middleware |
| `@sveltesentio/auth` | 7 | — | OIDC/session client, token refresh, permission rune stores |
| `@sveltesentio/realtime` | 8 | sveltekit-sse, @connectrpc/connect | SSE, WebSocket, ConnectRPC transport adapter |
| `@sveltesentio/flow` | 9 | @xyflow/svelte | Node editor wrappers, DAG helpers, canvas utilities |
| `@sveltesentio/media` | 10 | vidstack, hls.js, embla-carousel-svelte | Media player, HLS streaming, carousel, artwork grid |
| `@sveltesentio/charts` | 11 | layerchart | Dashboard chart wrappers, semantic color presets |
| `@sveltesentio/ai` | 12 | — | LLM chat components (streaming), edge AI (Transformers.js/WebGPU), semantic search |

## Conventions

### Commits
Conventional Commits required: `<type>(<scope>): <subject>`
Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`, `revert`
Breaking changes: `!` suffix + `BREAKING CHANGE:` footer + `Migration:` section with before/after

### Versioning
SemVer. All packages start at `0.0.1`. release-please manages versions from commits.

### PRs
- PR title must match Conventional Commits regex (enforced in CI)
- All CI checks must be green before merge
- Changesets not required (release-please reads commits directly)

### Package structure (every @sveltesentio/* package)
```
packages/<name>/
├── src/
│   └── index.ts          public API surface
├── package.json          @sveltesentio/<name>, exports map, sideEffects: false
├── tsconfig.json         extends ../../tsconfig.base.json
├── AGENTS.md             per-package agent guide (add when implementing)
└── README.md             usage docs (add when implementing)
```

## Do

- Use Svelte 5 runes (`$state`, `$derived`, `$props`, `$effect`) everywhere
- Use TanStack Query for all server state
- Use Superforms + Zod for all forms
- Use `openapi-fetch` for type-safe API clients
- Add `Migration:` footer when changing public API
- Test new components with axe-core before merging
- Match interface-type UX rules from `docs/ux-principles.md`

## Don't

- Don't use `$:` reactive statements (legacy Svelte 4)
- Don't use `writable()` stores for server state
- Don't use `any`
- Don't reference what apps currently use as the standard — the framework IS the standard
- Don't add deps without stating why alternatives were rejected
- Don't silence eslint without justification comment
