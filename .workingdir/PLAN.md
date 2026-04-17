# sveltesentio — Full Roadmap

## Phase 1 — Foundation (current)

Goal: repo + CI + rules + package stubs. No package implementations yet.

Deliverables:
- GitHub repo `golusoris/sveltesentio` with branch protection
- Full CI pipeline (lint, typecheck, test, build, audit, scorecard, codeql)
- Reusable CI/release workflows for downstream apps (`ci-sveltekit.yml`, `release-sveltekit.yml`)
- Philosophy docs (`docs/principles.md`, `docs/ux-principles.md`)
- Claude Code config (`CLAUDE.md`, `AGENTS.md`, `.claude/settings.json`, skills)
- 11 package stubs (core, ui, query, forms, i18n, auth, realtime, flow, media, charts, ai)
- Makefile + devcontainer for developer onboarding

## Phase 2 — @sveltesentio/core

Vite plugin, env schema validation (Zod), error types, id generators (UUIDv7/KSUID), mockable clock, base TypeScript config extension, logging (console.warn/error wrapper with structured output).

Key decisions: env validation approach (Zod schemas vs typed env only), error result type pattern.

## Phase 3 — @sveltesentio/ui

- shadcn-svelte CLI wrapper: `sveltesentio add <component>` → calls `npx shadcn-svelte@next add`
- Tailwind 4 preset with CSS design tokens per interface type
- mode-watcher integration with per-preset defaults
- Interface-type presets: `mediaPreset`, `dashboardPreset`, `webappPreset`, `pwaPreset`, `tenFootPreset`
- Design token system: spacing (8pt grid), typography scale, semantic colors
- Histoire setup for component documentation

## Phase 4 — @sveltesentio/query

TanStack Query v6 wrappers specifically for SvelteKit patterns:
- `createLoadQuery()` — typed query that integrates with SvelteKit `load()` functions
- `createServerStateQuery()` — SSR-hydrated query with proper dehydration/rehydration
- Optimistic update helpers
- Infinite query helpers for pagination
- Mutation helpers with toast integration (svelte-sonner)

## Phase 5 — @sveltesentio/forms

Superforms + Zod v4 patterns:
- `createForm()` — typed form factory with Zod schema
- Standard field components (Input, Select, Checkbox, Textarea, DatePicker)
- Error display component (maps Superforms errors to UI)
- File upload field with drag-drop
- Multi-step form helper

## Phase 6 — @sveltesentio/i18n

Paraglide-js v2 wrappers:
- SvelteKit hooks setup (locale detection from Accept-Language + URL prefix)
- `createI18n()` helper
- Locale switcher component
- Type-safe message accessor helpers
- RTL layout support utilities

## Phase 7 — @sveltesentio/auth

Client-side auth patterns (pairs with golusoris auth modules):
- OIDC/session client (token storage in httpOnly cookie via SvelteKit server)
- Permission stores: `$derived` rune-based permission checks
- Auth guard helpers for `+page.server.ts` load functions
- Login/logout/register form helpers
- JWT decode utility (no verification — verification is server-side only)

## Phase 8 — @sveltesentio/realtime

- SSE: `createSSESource()` wrapper around `sveltekit-sse`
- WebSocket: `createWebSocketStore()` — reactive store backed by WebSocket
- ConnectRPC: transport adapter for `@connectrpc/connect` in SvelteKit
- Connection state management (reconnect logic, exponential backoff)
- Yjs integration helpers for collaborative editing (pairs with app-subdo)

## Phase 9 — @sveltesentio/flow

@xyflow/svelte wrappers:
- Pre-configured `FlowCanvas` with dark theme + grid snap
- Standard node types (input, transform, output, group)
- Inspector panel component (right-side config for selected node)
- Mini-map component
- JSON serialization/deserialization helpers
- Undo/redo with immutable graph snapshots (via Immer or structuredClone)

## Phase 10 — @sveltesentio/media

- Vidstack wrapper: `MediaPlayer` component with preset configurations
- HLS.js integration for streaming
- `ArtworkGrid` — virtual-scrolled grid with dominant-color placeholders
- `ArtworkCard` — hover-state quick actions (play, queue, favorite)
- Playback bar component (sticky, never overlaps scroll)
- embla-carousel-svelte wrapper
- 10-foot UI preset: large targets, D-pad navigation, TV-safe margins

## Phase 11 — @sveltesentio/charts

Layerchart wrappers:
- `DashboardChart` — pre-styled for dark dashboard preset
- Semantic color presets (critical/warning/ok mapped to chart colors)
- `RealtimeChart` — chart that updates from SSE stream
- Standard chart types: line, area, bar, pie, sparkline
- Responsive helpers

## Phase 12 — @sveltesentio/ai

- `ChatStream` — streaming LLM chat UI (works with golusoris ai/llm/ backend)
- `MessageList` — chat message rendering with Markdown + code highlighting
- `ThinkingIndicator` — streaming response indicator
- Edge AI via Transformers.js (WebGPU/WASM): classifier, embedder, generator
- `useSemanticSearch()` — search composable (calls backend or edge model)
- `useAutoSuggest()` — debounced suggestion as-you-type
- `useImageAlt()` — auto-generate accessible alt text for images

## Phase 13 — CLI: create-sveltesentio

`npx create-sveltesentio` scaffolder (D16):

- `npx create-sveltesentio my-app` — interactive prompt → choose preset + packages → scaffold SvelteKit app
- Applies chosen interface-type token preset, installs selected `@sveltesentio/*` packages
- Sets up `components.json` for shadcn-svelte CLI, `.env.example`, devcontainer
- Wires `ci-sveltekit.yml` + `release-sveltekit.yml` reusable workflows into new app's CI

> **Note**: App migrations (app-arca, app-revenge, app-subdo) happen in each app's own repo —
> not in this repo. sveltesentio provides the packages; apps consume them on their own schedule.
