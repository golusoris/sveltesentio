# sveltesentio — Current State

## Phase 1 — Foundation (COMPLETE)

Completed: 2026-04-17

- [x] GitHub repo created: https://github.com/golusoris/sveltesentio
- [x] Git initialized, remote set, first commit pushed (e5cfb2a)
- [x] All 8 decisions resolved (see `.workingdir/research/decisions.md`)
- [x] Root config files (package.json, pnpm-workspace.yaml, turbo.json, tsconfig.base.json, eslint.config.js, prettier.config.js, commitlint.config.js, .editorconfig, .gitignore, Makefile)
- [x] GitHub Actions: ci.yml, ci-sveltekit.yml, release-please.yml, release-sveltekit.yml, scorecard.yml, codeql.yml, auto-assign.yml, dependabot.yml
- [x] Community health: CODEOWNERS, PULL_REQUEST_TEMPLATE.md, bug_report.yml, feature_request.yml, SECURITY.md, LICENSE
- [x] Philosophy: CLAUDE.md, AGENTS.md, docs/principles.md, docs/ux-principles.md
- [x] Release config: release-please-config.json, .release-please-manifest.json
- [x] Working directory: .workingdir/PLAN.md, .workingdir/STATE.md
- [x] Research dump: .workingdir/research/ (decisions, stack, apps-audit, ci-reference)
- [x] .claude/settings.json + skills (wire-module, scaffold-route, add-shadcn, add-histoire)
- [x] 11 package stubs (core, ui, query, forms, i18n, auth, realtime, flow, media, charts, ai)
- [x] devcontainer (.devcontainer/devcontainer.json)
- [x] Branch protection applied (lint/typecheck/test/build/audit + signed commits + linear history)

---

## Phase 2 — @sveltesentio/core (IN PROGRESS)

Started: 2026-04-17

### Deliverables

- [ ] `src/types.ts` — `Result<T,E>`, `Option<T>`, `Prettify<T>`, utility types
- [ ] `src/errors.ts` — AppError, HttpError, ok/err constructors, type guards
- [ ] `src/env.ts` — createEnv() Zod-validated env with SvelteKit PUBLIC_* split
- [ ] `src/id.ts` — UUIDv7 sortable ID generation
- [ ] `src/clock.ts` — Clock interface, systemClock, createTestClock()
- [ ] `src/log.ts` — createLogger() structured wrapper
- [ ] `src/vite.ts` — sentioPlugin() Vite plugin
- [ ] `src/index.ts` — re-exports
- [ ] Tests for all modules
- [ ] typecheck + test green

---

## Decision log

| Date | Decision | Choice | Reason |
|---|---|---|---|
| 2026-04-17 | D1: Release pipeline | release-please | Mirrors golusoris, zero manual steps |
| 2026-04-17 | D2: npm scope | Public npm @sveltesentio/* | Open source, same as golusoris philosophy |
| 2026-04-17 | D3: shadcn approach | CLI wrapper | Preserves shadcn copy-paste model, framework owns config |
| 2026-04-17 | D4: Reusable CI | Yes (ci-sveltekit.yml) | Mirrors golusoris ci-go.yml pattern |
| 2026-04-17 | D5: Theme default | Per interface-type preset | Media=dark, webapp=system, pwa=system |
| 2026-04-17 | D6: Icons | Both (iconify default + lucide opt-in) | app-arca uses iconify, app-revenge uses lucide |
| 2026-04-17 | D7: ConnectRPC | Yes, in @sveltesentio/realtime | app-subdo requires it |
| 2026-04-17 | D8: Component docs | Histoire | Svelte 5 native, Vite-powered, fast |
