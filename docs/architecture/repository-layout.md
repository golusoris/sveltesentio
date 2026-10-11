# Repository layout

This page holds the annotated directory tree of the sveltesentio workspace. The agent guide
([AGENTS.md](../../AGENTS.md)) carries a short table of the same layout and points here for the detail.

Sub-exports such as `ui/toast` are module subpaths of their package, not directories.

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
├── .release-please-manifest.json   # per-package published version manifest
├── renovate.json                   # Renovate dependency updates (Dependency Dashboard issue #42)
│
├── packages/                       # @sveltesentio/* publishable modules — 19 published; see the package purpose table below
│   ├── core/                       # every package follows this shape:
│   │   ├── src/index.ts            #   the entire public API (named exports only)
│   │   ├── src/internal/           #   off-limits to consumers
│   │   ├── AGENTS.md               #   per-package conventions — read before touching the area
│   │   └── README.md
│   └── …                           # ai · api · auth · charts · collab · emulator · flow · forms · i18n
│                                   # ipc-sockmap · mcp · media · query · realtime · shell · testing · ui · uploads
│                                   # Sub-exports (ui/toast, media/player, …) are module subpaths, not directories.
│
├── apps/                           # consuming apps (integration tests + showcase)
│   ├── storybook/                  # Storybook 10 component showcase (Svelte 5; axe via addon-a11y)           [LANDED]
│   ├── docs/                       # docs site (principles/ADRs rendered via mdsvex)                          [LANDED]
│   └── integration/                # integration-test app consuming every published package
│
├── examples/                       # 19 per-package canonical usage snippets + README
│
├── docs/
│   ├── principles.md               # §2 full coding + security + compliance contract
│   ├── ux-principles.md            # §3 UI/UX rules per interface type (oklch, 8pt grid, etc.)
│   ├── adr/                        # Architecture Decision Records (MADR-lite, 52 ADRs as of 2026-04-17)
│   ├── architecture/               # C4 PlantUML diagrams (Context L1 + Container L2)
│   ├── migrations/                 # per-version API migration guides + codemods (v0.1 downstream antipatterns live here)
│   ├── compliance/                 # OWASP ASVS L2 / WCAG 2.2 AA / EU CRA / EU AI Act checklists
│   ├── compose/                    # composition recipes for upstream libs we deliberately don't wrap
│   └── upstream/                   # pinned upstream doc snapshots (offline-ready for AI agents; 6 snapshots, refreshed by refresh-upstream-docs.yml)
│
├── .claude/
│   ├── settings.json               # hooks (PreToolUse, PostToolUse prettier, PreCommit `make ci`)
│   └── skills/                     # /wire-module · /scaffold-route · /add-shadcn · /add-storybook
│
├── .github/
│   ├── CODEOWNERS                  # @lusoris global
│   ├── ISSUE_TEMPLATE/             # bug / feature / docs
│   ├── PULL_REQUEST_TEMPLATE.md    # requires Migration: footer when `!`
│   └── workflows/                  # ci · ci-sveltekit (reusable) · release-please · refresh-upstream-docs
│                                   # scorecard · codeql · auto-assign — see "CI gates" for what each enforces
│
├── .devcontainer/
│   └── devcontainer.json           # Node 24 (ADR-0021), pnpm, zsh + oh-my-zsh, 15 VS Code extensions, ports 5173/4173/6006
│
├── .workingdir/                    # local-only planning state, gitignored (PLAN · STATE · V0.1.0 · BACKLOG)
│   └── research/                   # per-library audits, app deep-reads, and the D-row decision ledger
│                                   # (decisions-needed.md is the one to read first — see "When in doubt")
│
├── CLAUDE.md                       # compiled from AGENTS.md by `praetorctl compile-context`; never edited by hand
├── AGENTS.md                       # this file
├── README.md                       # user-facing pitch + module table
├── SECURITY.md                     # coordinated-disclosure process
├── LICENSE                         # MIT
├── CODE_OF_CONDUCT.md              # Contributor Covenant 2.1 (stub pointing to upstream)
├── CONTRIBUTING.md                 # dev workflow for contributors
└── CHANGELOG.md                    # Keep a Changelog 1.1 (release-please-managed)
```
