# Agent guide — sveltesentio

> Cross-tool context for [Claude Code](https://claude.com/claude-code), [Cursor](https://cursor.sh), [Aider](https://aider.chat), [Codex](https://github.com/openai/codex), [Continue](https://continue.dev), and other coding assistants.
> **Read this before suggesting changes.** Then read the per-subpackage `AGENTS.md` for the area you're touching.

## What this repo is

`sveltesentio` is a pnpm workspace monorepo (`github.com/lusoris/sveltesentio`) that wraps a pinned set of best-in-class libraries as opt-in `@sveltesentio/*` packages. Apps compose only what they need — nothing else ships.

sveltesentio is the **SvelteKit analog of [golusoris/golusoris](https://github.com/golusoris/golusoris)** (the Go meta-framework this same author maintains). Same opt-in module discipline, same compliance posture (OWASP ASVS L2 / WCAG 2.2 AA / SLSA L3 / EU CRA / EU AI Act), same AI-assisted-development conventions (AGENTS.md + CLAUDE.md + Skills + Hooks) — expressed in Svelte 5 runes + TypeScript instead of Go + fx.

See [README.md](README.md) for the user-facing pitch and [docs/principles.md](docs/principles.md) for the full coding contract (§2) and [docs/ux-principles.md](docs/ux-principles.md) for UX rules (§3).

## Hard rules

1. **Never break public API** without a `Migration:` footer (before/after Svelte snippet) + a codemod (or explicit "manual migration" note with line-level diff guidance). CI runs API-extractor against the previous tag.
2. **Never add a transitive dependency** without weighing alternatives from the awesome-lists harvest (see `.workingdir/research/svelte-ecosystem-audit.md`). State the choice in the PR if non-obvious.
3. **Every package's public surface is its `src/index.ts` named exports** (+ documented sub-exports like `ui/toast`, `media/player`). Apps never import internals (anything under `src/internal/` or unexported). Package `exports` map is the enforcement gate.
4. **No top-level side effects in package modules.** No `window.` access, no DOM reads, no `setInterval` at import time. Use vite plugins, SvelteKit hooks, or explicit `register(app)` entry points.
5. **All errors flow through `@sveltesentio/core/errors`** (RFC 9457 `application/problem+json` parser + typed `ProblemDetails`). Never throw raw `Error` from package code.
6. **All time uses `@sveltesentio/core/clock`.** `Date.now()` / `new Date()` / `performance.now()` are banned in package source outside `test/` (enforced by custom eslint rule — see `eslint.config.js`).
7. **No `console.log` in package source.** `console.warn` / `console.error` only, or the structured logger from `@sveltesentio/core/log` once it lands. Enforced by eslint `no-console`.
8. **Svelte 5 runes-first.** Never `$:`, never `writable()` for server state (use `@sveltesentio/query`), never `export let` (use `$props()`). Enforced by eslint-plugin-svelte.
9. **No `any` — ever.** Use `unknown` and narrow with Zod or type guards. Enforced by `@typescript-eslint/no-explicit-any: error`.
10. **Every merged commit: 0 eslint · 0 tsc · 0 `pnpm audit` vulns · axe-clean on stories.** `// eslint-disable-*` requires a justification comment on the adjacent line.
11. **No guessing on major decisions.** Agents never lock library picks, module surface, API shape, or compliance posture on their own. The agent's job is to present evidence + ≥ 2 named alternatives and open/update a `D*` row in [.workingdir/research/decisions-needed.md](.workingdir/research/decisions-needed.md). Only the project owner (`@lusoris`) closes a `D*` row to `locked (ADR-NNNN)`. Evidence = (a) cited file:line in a `golusoris/app-*` repo, (b) measured benchmark / bundle analysis, or (c) an existing ADR. "Seems good", "commonly used", and awesome-list consensus are **not** evidence — they're pointers to where evidence could be gathered.
12. **Strict SvelteKit universe.** Library picks must be (a) Svelte 5 runes-native with first-class TS types, or (b) framework-agnostic libraries that compose cleanly with SvelteKit SSR (TanStack, Zod, Yjs, Vite plugins, ConnectRPC, openapi-fetch, elkjs, etc.). Never pull React/Vue/Solid component libraries via cross-framework bridges — a non-Svelte UI dep is an architectural smell. If a capability exists only outside the Svelte ecosystem, open a `D*` row and discuss before adding a bridge.

See [docs/principles.md](docs/principles.md) for the Power-of-10, OWASP ASVS L2, WCAG 2.2 AA, supply-chain, testing, and performance contract. Deviations require a PR comment citing the subsection.

## Workflow discipline (evidence-driven)

sveltesentio is deliberately **research-first**. The author maintains existing Svelte apps (`golusoris/app-arca`, `app-revenge`, `app-subdo`, `app-lurkarr`) — **those apps are the source of truth** for what patterns deserve to be promoted into the framework.

Before proposing a new package, sub-export, or API shape, an agent must:

1. Check [.workingdir/research/decisions-needed.md](.workingdir/research/decisions-needed.md) — is the question already open? Add evidence there instead of shipping a guess.
2. Check [.workingdir/research/svelte-ecosystem-audit.md](.workingdir/research/svelte-ecosystem-audit.md) — is the upstream library already evaluated? Does it obsolete the proposed wrapper?
3. Check [.workingdir/research/existing-apps-deepread.md](.workingdir/research/existing-apps-deepread.md) — has the pattern been observed in ≥ 2 existing apps? One-off patterns stay in their app.
4. If no evidence exists yet: **do research, don't guess.** Open a `D*` row in `decisions-needed.md` and wait for evidence.

**Streamlining rule** (2026-04-17): if an existing library in the Svelte / Tailwind / JS ecosystem already solves a problem cleanly, do **not** wrap it into a `@sveltesentio/*` package. Instead, document the composition pattern in `docs/compose/` and let consumers import the upstream library directly. Wrappers are only justified when they (a) enforce a cross-cutting invariant from `docs/principles.md`, (b) compose multiple libraries into a pinned matrix, or (c) encode a decision that would otherwise be re-litigated per app.

## Repository layout

Granular tree — every directory that exists or is planned. Sub-exports (e.g. `ui/toast`) are rendered as sub-directories even when implemented as module subpaths.

```text
sveltesentio/
├── package.json                    # pnpm workspace root, scripts, pinned devDeps
├── pnpm-workspace.yaml             # packages/* and apps/*
├── turbo.json                      # task pipeline (build/lint/typecheck/test/dev)
├── Makefile                        # setup · dev · build · ci · clean · add-package
├── tsconfig.base.json              # shared strict TS (ES2022, noUncheckedIndexedAccess, exactOptional)
├── eslint.config.js                # flat ESLint (TS + Svelte + a11y + prettier + custom rules)
├── prettier.config.js              # Prettier + prettier-plugin-svelte
├── commitlint.config.js            # Conventional Commits 1.0 enforcement
├── release-please-config.json      # release-please per-package versioning
├── .release-please-manifest.json   # version manifest (all packages start 0.0.1)
│
├── packages/                       # @sveltesentio/* publishable modules
│   ├── core/                       # env schema, errors (RFC 9457 parser), id, clock, CSP helpers, openapi-fetch presets, vite plugin
│   │   ├── src/
│   │   │   ├── index.ts            # public API
│   │   │   └── internal/           # off-limits to consumers
│   │   ├── AGENTS.md               # per-package agent guide (add when implementing)
│   │   └── README.md
│   ├── ui/                         # Tailwind 4 preset + oklch tokens + shadcn-svelte CLI wrapper + interface-type presets
│   │   ├── preset-desktop/         # default desktop dashboard tokens
│   │   ├── preset-10foot/          # TV UI — 44px+ hit targets, focus ring, high contrast (ADR-0047)
│   │   ├── preset-handheld/        # phone / deck landscape, safe-area insets
│   │   ├── preset-dashboard/       # admin dashboard overrides on top of desktop
│   │   ├── data/                   # virtualized list/grid/table (TanStack Virtual + TanStack Table, ADR-0011 + ADR-0024)
│   │   ├── markdown/               # marked + DOMPurify sanitized renderer (ADR-0026)
│   │   ├── cmd/                    # cmd+K command palette + bits-ui Command + tinykeys shortcuts (ADR-0015 + ADR-0025)
│   │   ├── icons/                  # @lucide/svelte default + pluggable @iconify/svelte loader (ADR-0002)
│   │   ├── chart/                  # a11y wrapper over LayerChart + uPlot escape hatch (ADR-0013)
│   │   ├── theme-toggle/           # mode-watcher + cookie + user-account override (ADR-0048)
│   │   ├── theme-customizer/       # user-customiser opt-in (ADR-0046)
│   │   ├── font-preset-{inter,geist,mono}/ # Fontsource variable-font opt-in (ADR-0049)
│   │   └── toast/                  # svelte-sonner wrapper with interface-type theming (ADR-0016)
│   ├── query/                      # TanStack Query v5 SvelteKit integration — SSR hydration, optimistic, pagination
│   ├── forms/                      # Superforms v2 + Zod v4 patterns, field components, error mapping
│   ├── i18n/                       # Paraglide-js v2 locale middleware, RTL, message helpers, money/number formatting
│   ├── auth/                       # OIDC + PKCE client, passkeys (@simplewebauthn/browser), session, permission runes, TOTP MFA UI
│   ├── realtime/                   # sveltekit-sse + @connectrpc/connect-web + WebSocket transport adapter
│   ├── collab/                     # Yjs CRDT + Svelte binding + y-websocket provider
│   ├── flow/                       # @xyflow/svelte wrappers — DAG helpers + elkjs layout (canvas + palette deferred)
│   ├── uploads/                    # tus-js-client + presigned S3 direct-to-browser + EXIF/MIME/size guards   [NEW — pending D100..D102]
│   ├── media/
│   │   ├── player/                 # Vidstack + HLS.js — trickplay, skip-intro, syncplay, subtitle rendering
│   │   ├── image/                  # artwork grid, lightbox, embla-carousel, EXIF strip
│   │   └── game/                   # EmulatorJS wrapper + WebRTC netplay (simple-peer)
│   ├── shell/                      # device-class layouts — desktop / 10-foot D-pad / handheld / PWA install + update   [NEW — pending D140..D143]
│   ├── charts/                     # Layerchart wrappers + dashboard presets
│   ├── ai/                         # LLM chat components (streaming), edge AI (@huggingface/transformers WebGPU), semantic search, EU AI Act audit hook (ADR-0043 + ADR-0044 + ADR-0045)
│   ├── ipc-sockmap/                # Tier 3 kernel-bypass IPC client (eBPF SK_MSG sockhash; Linux + cgroup v2 + kernel ≥5.10)   [ADR-0051, blocked on golusoris/golusoris#27]
│   ├── mcp/                        # MCP server — exposes ADR/compose/compliance docs + module-lookup tool to AI clients   [Phase 1b]
│   └── testing/                    # testClock + a11y harness + Superforms + TanStack Query fixtures   [ADR-0031 + ADR-0052]
│
├── apps/                           # consuming apps (integration tests + docs site)                         [NOT YET CREATED]
│   ├── docs/                       # docs site (Histoire + principles/ADRs rendered)
│   └── e2e/                        # integration-test app consuming every v0.1.0 package
│
├── examples/                       # minimal per-module usage snippets                                      [NOT YET CREATED]
│
├── docs/
│   ├── principles.md               # §2 full coding + security + compliance contract
│   ├── ux-principles.md            # §3 UI/UX rules per interface type (oklch, 8pt grid, etc.)
│   ├── adr/                        # Architecture Decision Records (MADR-lite, 52 ADRs as of 2026-04-17)
│   ├── architecture/               # C4 PlantUML diagrams (Context L1 + Container L2)
│   ├── migrations/                 # per-version API migration guides + codemods (v0.1 downstream antipatterns live here)
│   ├── compliance/                 # OWASP ASVS L2 / WCAG 2.2 AA / EU CRA / EU AI Act checklists
│   ├── compose/                    # composition recipes for upstream libs we deliberately don't wrap
│   └── upstream/                   # pinned upstream doc snapshots (offline-ready for AI agents)          [Phase 1b — 6 snapshots landed]
│
├── .claude/
│   ├── settings.json               # hooks (PreToolUse, PostToolUse prettier, PreCommit `make ci`)
│   └── skills/
│       ├── wire-module.md          # /wire-module — add a new @sveltesentio/* package
│       ├── scaffold-route.md       # /scaffold-route — generate SvelteKit route + Superforms + TanStack Query
│       ├── add-shadcn.md           # /add-shadcn — shadcn-svelte CLI wrapper
│       └── add-histoire.md         # /add-histoire — add a Histoire story for a component
│
├── .github/
│   ├── CODEOWNERS                  # @lusoris global
│   ├── ISSUE_TEMPLATE/             # bug / feature / docs
│   ├── PULL_REQUEST_TEMPLATE.md    # requires Migration: footer when `!`
│   ├── dependabot.yml              # weekly deps
│   └── workflows/
│       ├── ci.yml                  # PR-title + lint + typecheck + test + build + audit
│       ├── ci-sveltekit.yml        # REUSABLE — downstream apps call this
│       ├── release-please.yml      # release-please orchestrator
│       ├── release-sveltekit.yml   # REUSABLE — npm publish + cosign + syft SBOM + SLSA provenance
│       ├── scorecard.yml           # OpenSSF Scorecard
│       ├── codeql.yml              # CodeQL JS/TS
│       └── auto-assign.yml         # assign @lusoris on issues/PRs
│
├── .devcontainer/
│   └── devcontainer.json           # Node 24 (ADR-0021), pnpm, zsh + oh-my-zsh, 15 VS Code extensions, ports 5173/4173/6006
│
├── .workingdir/                    # persistent plan + state across machines/sessions (gitignored? no — committed!)
│   ├── PLAN.md                     # full multi-phase roadmap (source of truth for framework design)
│   ├── STATE.md                    # current status + decision log
│   ├── V0.1.0.md                   # concrete first-tag release goal
│   └── research/
│       ├── governance-gaps.md      # gap analysis vs. golusoris/golusoris template
│       ├── module-coverage.md      # downstream-app need vs. module surface
│       ├── module-backlog.md       # full golusoris-module cross-reference (~60 candidates)
│       ├── decisions-needed.md     # open decisions (D1..D166+) with evidence requirements
│       ├── existing-apps-deepread.md  # plan to actually read arca/subdo/revenge/lurkarr source
│       ├── svelte-ecosystem-audit.md  # per-library evaluation template + buckets
│       ├── awesome-harvest.md      # awesome-list digests (done 2026-04-17)
│       ├── ecosystem-pass-1-summary.md  # cross-batch ecosystem audit aggregation
│       ├── deepread-{arca,subdo,revenge,lurkarr}.md  # per-app deep-read findings
│       ├── d13-clock-injection.md  # live-docs research for ADR-0052
│       └── reaudit-d{112,120,50}-*.md  # 4-axes re-audit reports
│
├── CLAUDE.md                       # Claude Code-specific guide (hooks, skills, project principles)
├── AGENTS.md                       # this file
├── README.md                       # user-facing pitch + module table
├── SECURITY.md                     # coordinated-disclosure process
├── LICENSE                         # MIT
├── CODE_OF_CONDUCT.md              # Contributor Covenant 2.1 (stub pointing to upstream)
├── CONTRIBUTING.md                 # dev workflow for contributors
└── CHANGELOG.md                    # Keep a Changelog 1.1 (release-please-managed)
```

Per-subpackage `AGENTS.md` files give package-level conventions, idioms, and pinned doc URLs. Create one for each package when its Phase lands (not before).

## Package purpose table

| Package | Phase | Key dependencies | What it provides |
| --- | --- | --- | --- |
| `@sveltesentio/core` | 2 | vite, zod, openapi-fetch | env schema, RFC 9457 error parser, id/clock utils, CSP helpers, vite plugin |
| `@sveltesentio/ui` | 3 | shadcn-svelte, bits-ui, tailwindcss@4, mode-watcher | Tailwind preset, oklch tokens, shadcn CLI wrapper, interface-type presets |
| `@sveltesentio/query` | 4 | @tanstack/svelte-query | load helpers, optimistic updates, SSR hydration, pagination |
| `@sveltesentio/forms` | 5 | sveltekit-superforms, zod | form patterns, field components, action helpers, error mapping |
| `@sveltesentio/i18n` | 6 | @inlang/paraglide-js | locale detection, message helpers, SvelteKit middleware, RTL |
| `@sveltesentio/auth` | 7 | openid-client, @simplewebauthn/browser | OIDC/session client, passkeys, permission runes, TOTP MFA |
| `@sveltesentio/realtime` | 8 | sveltekit-sse, @connectrpc/connect-web | SSE + ConnectRPC + WebSocket transport adapter |
| `@sveltesentio/collab` | 8b | yjs, y-websocket, y-indexeddb | CRDT + Svelte binding + sync provider |
| `@sveltesentio/flow` | 9 | @xyflow/svelte | node editor wrappers, DAG helpers, canvas utilities |
| `@sveltesentio/uploads` | 9b | tus-js-client, exifr, file-type | resumable uploads + presigned S3 + client-side guards |
| `@sveltesentio/media` | 10 | vidstack, hls.js, embla-carousel-svelte | player/image/game sub-exports |
| `@sveltesentio/shell` | 10b | (TBD — see D140..D143) | device-class layouts, D-pad routing, PWA install |
| `@sveltesentio/charts` | 11 | layerchart | dashboard chart wrappers, semantic color presets |
| `@sveltesentio/ai` | 12 | @anthropic-ai/sdk (server), @huggingface/transformers, ollama-js (proxy) | LLM chat streaming, edge AI, semantic search, audit hook |
| `@sveltesentio/ipc-sockmap` | 12b | (Linux-only; reads pinned BPF sockhash owned by golusoris) | Tier 3 kernel-bypass client for colocated SvelteKit ↔ Golusoris IPC (ADR-0051; blocked on golusoris/golusoris#27) |
| `@sveltesentio/testing` | ortho | vitest (optional peer), @axe-core/playwright | `testClock({ now })` (ADR-0052), a11y harness (ADR-0031), Superforms + TanStack Query fixtures |
| `@sveltesentio/mcp` | ortho (Phase 1b) | @modelcontextprotocol/sdk | MCP server exposing ADR/compose/compliance docs + module-lookup tool to Claude Code / Cursor / Aider / Codex / Continue |

**This list is the v0.1.0 shortlist hypothesis — see [.workingdir/V0.1.0.md](.workingdir/V0.1.0.md). It may shrink after the awesome-lists harvest obsoletes some wrappers, or expand if the deep-read surfaces a capability not yet named.**

Deferred to post-v0.1.0: `observability`, `notify`, `page`, `outbox`, `leader`, `pdf`, `ocr`, `search`, `fs`, `payments`. See [.workingdir/research/module-backlog.md](.workingdir/research/module-backlog.md) for the full golusoris cross-reference.

## Common tasks

| Task | Command / Skill |
| --- | --- |
| Add a new `@sveltesentio/*` package | `/wire-module` skill |
| Scaffold a SvelteKit route (Superforms + TanStack Query) | `/scaffold-route` skill |
| Add a shadcn-svelte component | `/add-shadcn` skill |
| Add a Histoire story | `/add-histoire` skill |
| Bootstrap dev environment | `make setup` |
| Run full CI locally | `make ci` |
| Add a new root-level dep | `pnpm add -Dw <dep>` |
| Add a workspace-package dep | `pnpm --filter @sveltesentio/<pkg> add <dep>` |
| Create release PR | (automated by release-please — open a branch + Conventional-Commit PR; `release-please.yml` runs on merge) |

## Pinned upstream docs

Version-pinned snapshots live in `docs/upstream/` (NOT YET CREATED). Until that directory exists, check the library repo directly for the exact version in `pnpm-lock.yaml`. Public docs may be ahead of or behind the pinned version.

Current peer-range targets (consumers must satisfy these):

| Package | Version target | Notes |
| --- | --- | --- |
| `svelte` | ^5.55.4 | runes-first; no Svelte 4 compat |
| `@sveltejs/kit` | ^2.x | exact minimum TBD in D5 |
| `vite` | ^5 or ^6 | TBD — depends on rolldown timing |
| `typescript` | ^6.0.3 | ADR-0020; published peerDep `>=5.5 <7` |
| `zod` | ^4 | v3 unsupported |
| `tailwindcss` | ^4 | v3 unsupported; preset compatible only with v4 |
| `@tanstack/svelte-query` | ^6 | ADR-0008 |
| `node` | >=24 | ADR-0021; LTS; closes D5 |
| `pnpm` | >=10 | workspace features required |

## CI gates

Every PR must pass:

- **Conventional Commits** PR title (`commitlint` via `ci.yml`).
- **ESLint flat config** — 0 errors (TS + Svelte + a11y).
- **Prettier** — formatted (checked; not auto-fixed in CI).
- **TypeScript** — 0 errors across workspaces (`turbo typecheck`).
- **Vitest** — green + ≥ 70% coverage (≥ 85% for `auth`, `forms`).
- **Playwright** — e2e green (when `apps/e2e` lands).
- **axe-core** — clean on every Histoire story.
- **`pnpm audit`** — clean (no `>=high` advisories).
- **`codeql.yml`** — clean.
- **`scorecard.yml`** — score ≥ 7.

Release PRs additionally:

- **cosign** — signed artifacts via `release-sveltekit.yml`.
- **syft** — CycloneDX SBOM attached.
- **SLSA L3 provenance** — attested via `slsa-framework/slsa-github-generator`.
- **`npm publish --provenance`** — required for the npm registry provenance badge.

## When in doubt

1. Read [docs/principles.md](docs/principles.md) for the coding/security/compliance contract (§2).
2. Read [docs/ux-principles.md](docs/ux-principles.md) for UI/UX rules per interface type (§3).
3. Read the per-subpackage `AGENTS.md` for the area you're touching.
4. Read [.workingdir/STATE.md](.workingdir/STATE.md) for what the author is currently working on + locked decisions.
5. Read [.workingdir/PLAN.md](.workingdir/PLAN.md) for the full roadmap + framework mission.
6. If a decision isn't locked yet, check [.workingdir/research/decisions-needed.md](.workingdir/research/decisions-needed.md) and **add evidence, don't ship a guess**.
