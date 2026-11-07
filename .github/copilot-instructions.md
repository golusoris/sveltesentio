<!-- markdownlint-disable MD013 -->
<!-- Compiled automatically by praetorctl compile-context from AGENTS.md. DO NOT EDIT DIRECTLY. -->

<!-- markdownlint-disable MD013 MD025 -->

<!-- markdownlint-disable MD013 -->
# golusoris/sveltesentio Agent Operating Harness

Before concluding any turn:

```bash
make verify-all
```

`make verify-all` = repository-owned gate; adoption kept it unread + unexecuted. Steps live in `Makefile`: read there, never restate. Footer commands = project markers only.
Pass = exit 0. Signed Ed25519 Exit-0 receipt only from `praetorctl gate run`; report no receipt it did not mint. Fail -> SARIF diagnostic distillation (<= 1500 tokens).

## Core Directives & Invariants

Adopted check = check adoption generated here (praetor `lefthook.yml`), as written at adoption; later edits to those files not reflected. `not enforced` = rule binds, no generated check decides it for repository languages.

| Invariant | Rule | Adopted check | On fail |
| :--- | :--- | :--- | :--- |
| **HISS-01** control flow | recursion prohibited; call graph = DAG | not enforced | advisory |
| **HISS-02** loops, I/O | scalar upper bound on every loop; explicit deadline on every I/O call | not enforced | advisory |
| **HISS-03** memory | n/a: no such construct in repository languages; advisory | not enforced | advisory |
| **HISS-04** complexity | McCabe cyclomatic <= 10, cognitive <= 12, statements <= 40; func LOC <= 60 (audit ceiling) | not enforced | advisory |
| **HISS-05** scoping | declare every identifier in smallest lexical scope serving it | not enforced | advisory |
| **HISS-06** concurrency | explicit scalar upper bound on every worker pool + concurrent fan-out | not enforced | advisory |
| **HISS-07** errors | every error handled or wrapped with context | not enforced | advisory |
| **HISS-08** determinism | zero dynamic code execution (`eval` / `exec`) | not enforced | advisory |
| **HISS-09** reference safety | n/a: no such construct in repository languages; advisory | not enforced | advisory |
| **HISS-10** warnings | zero warnings: compiler, linter, format sweeps | not enforced | advisory |
| **HISS-11** supply chain | pinned lockfiles; zero floating tags; signed provenance | not enforced | advisory |
| **HISS-12** secrets | zero credentials in Git history | not enforced | advisory |
| **HISS-13** debt ratchet | recorded infractions never grow vs committed baseline | `praetorctl audit` ratchet vs `.standards-baseline.json` in lefthook pre-commit/pre-push | growth blocks commit, blocks push |
| **HISS-14** append-only ABI | public API append-only; breaking change = `!` subject + `Migration:` footer | not enforced | advisory |
| **HISS-15** 3D testing | positive + negative + boundary tests, every public interface | not enforced | advisory |
| **HISS-16** context integrity | single canonical `AGENTS.md`; vendor files compiled via `praetorctl compile-context` | `praetorctl compile-context --verify` in lefthook pre-commit | drift blocks commit |
| **HISS-17** state ledger | turn start `praetorctl state status`; turn end `praetorctl state sync .` | `praetorctl state sync .` in lefthook post-commit | none; records only |
| **HISS-18** CI efficiency | diff-aware gating via `praetorctl ci filter` | not enforced | advisory |
| **HISS-19** reuse before writing | one behavior = one implementation; extend or call existing code | not enforced | advisory |
| **HISS-20** replayable evidence | every enforcement claim backed by fixtures replayed both directions | not enforced | advisory |
| **HISS-21** platform neutrality | gates, hooks, emitted templates run on Linux, macOS, Windows, or skip with stated reason | not enforced | advisory |

## Operational Rules

1. **Act on verified state.** Read source files, run real commands before hypothesis or edit. Never guess flag names, library signatures, repo configuration from memory.

2. **Lead with output.** Direct answers, diffs, commands. No filler preamble, no "Based on", no restatement, no chatter.

3. **Context transpiler first.** Never edit `CLAUDE.md`, `.cursor/rules/hiss-invariants.mdc`, `.github/copilot-instructions.md`, `.windsurfrules`, `.gemini/GEMINI.md`, `.codex/rules.md` manually. All agent instruction updates -> `AGENTS.md`, then:

   ```bash
   praetorctl compile-context
   ```

   - `AGENTS.md` = agent-only text -> caveman (internal register). `praetorctl compile-context --verify` + `praetorctl audit` run caveman lint; findings fail gate; no opt-out. Check first: `praetorctl caveman check --kind=context AGENTS.md`.

4. **SARIF diagnostic distillation.** Compiler/linter errors -> distill to $\le 1,500$ tokens ($< 60$ lines): top 3 root-cause failures with file/line pointers; full SARIF logs -> ephemeral storage.

5. **No evasion.** Never attempt `--no-verify`, `LEFTHOOK=0`, or modifying `.git/hooks`. Hooks = local gate adoption installs. Adoption adds no server-side `praetorctl` gate run. Scaffolded CI: `.github/workflows/praetor-docs.yml` runs step `Stop on a draft pull request`, `node tools/markdownlint/verify.mjs`, step `Verify figures`; `.github/workflows/reuse.yml` runs step `Stop on a draft pull request`.

6. **Anti-loop interception.** Same AST diff + error category repeats $\ge 3$ times -> halt immediately. Re-evaluate design; no micro-textual retries.

## Text Register

<!-- praetor:register:start -->
Register follows the audience, then the task label of your brief (`register:` in `.standards.yaml`; labels are the router's `target_tasks`).

| Register | Where | Form |
| :--- | :--- | :--- |
| social | forge: issues, PR bodies, review comments, commit bodies | `social-text` skill: BLUF, full sentences, scannable, enough and no more; conventional commit subject unchanged |
| docs | docs/, README, ADR bodies | complete without bloat: newcomer path first, expert reference after; every claim points at a file, command or test; no restated code |
| internal | briefs, agent-to-agent traffic, research fan-outs, workflow returns | `caveman` skill: fragments, no filler, verbatim code/paths/errors; facts, paths, commands, verdict |

- Task rows: social = commit_message_synthesis, waiver_signoff; docs = architecture_synthesis, function_docstrings; every other label and any unlabeled text = internal. Subagent launch brief: `caveman` brief shape with `task:` = routing label.
- Evidence above 58 lines or 1500 tokens leaves the message as a file under `.workingdir/evidence/`; return `evidence: <path> sha256:<12 hex> lines:<n>` and fetch it only when a decision needs it.
- An internal return carries verdict, changed paths, commands run, evidence pointers and open questions, nothing else.
<!-- praetor:register:end -->

## Primary Verification Commands

```bash
# Fast local test suite
# Declared commands only; run them before claiming application verification.
'make' 'verify-all'

# Recompile and verify cross-agent context outputs
praetorctl compile-context --verify

# Audit repository against declared HISS standards
praetorctl audit

# Repository gate; steps live in Makefile
make verify-all
```

<!-- markdownlint-enable MD013 -->
<!-- markdownlint-disable MD025 -->
<!-- praetor:harness:end -->

---

<!-- markdownlint-disable MD013 -->

# Agent guide — sveltesentio

> Read before suggesting changes. Then read per-subpackage `AGENTS.md` for touched area.

## What this repo is

pnpm monorepo, 19 `@sveltesentio/*` packages. SvelteKit analog of golusoris/golusoris. Svelte 5 runes + TypeScript. Compliance: ASVS L2, WCAG 2.2 AA, SLSA L2 (#280 tracks L3), EU CRA, EU AI Act. Pointers: [docs/principles.md](../docs/principles.md) (§2), [docs/ux-principles.md](../docs/ux-principles.md) (§3).

## HISS in this repository

Harness table above declares every HISS invariant with its adopted check and failure action. TypeScript adaptations: HISS-03/09 have no analogue; HISS-11..14 tracked by HISS-20 coverage catalog. Repository enforcement tools per invariant: harness table "Adopted check" column; `make verify-all` gate: see [Makefile](../Makefile).

## Hard rules

1. **No public API break** without `Migration:` footer + codemod or manual diff. No gate yet (#288).
2. **No new transitive dep** without weighing alternatives (`svelte-ecosystem-audit.md`).
3. **Public surface = `src/index.ts` named exports** + documented sub-exports. Apps never import `src/internal/` (exception requires a locked `D*` row in `.workingdir/research/decisions-needed.md`).
4. **No top-level side effects** in package modules — no `window.`, no DOM reads, no `setInterval` at import.
5. **All errors via `core/errors`** (RFC 9457). Never throw raw `Error` (exception: test helpers; justify in PR).
6. **All time via `core/clock`.** `Date.now()` / `new Date()` / `performance.now()` banned in package source outside `test/`. ESLint rule enforced.
7. **No `console.log`** in package source. `console.warn`/`console.error` only. ESLint `no-console`.
8. **Svelte 5 runes-first.** No `$:`, no `writable()` for server state (use `@sveltesentio/query`), no `export let`. ESLint enforced.
9. **No `any`.** Use `unknown` + Zod / type guards.
10. **0 eslint · 0 tsc · 0 audit vulns · axe-clean** on every merge. `eslint-disable` needs justification comment on adjacent line.
11. **No guessing on major decisions.** Evidence + >=2 alternatives, open `D*` row. Only owner closes to `locked (ADR-N)`.
12. **Strict SvelteKit universe.** Svelte 5 runes-native or framework-agnostic only. No React/Vue/Solid bridges; non-Svelte UI dep = `D*` row.

Full contract: [docs/principles.md](../docs/principles.md). Deviations cite subsection in PR.

## Workflow discipline

Research-first. Before new package/sub-export/API: check `decisions-needed.md`, `svelte-ecosystem-audit.md`, `existing-apps-deepread.md` (all in `.workingdir/research/`). No evidence -> open `D*` row, wait. Upstream lib solves it -> `docs/compose/` pattern, not wrapper. Wrappers only for: (a) `principles.md` invariant, (b) pinned lib matrix, (c) decision re-litigated per app.

## Repository layout

Full tree: [docs/architecture/repository-layout.md](../docs/architecture/repository-layout.md). `packages/<name>/` = 19 modules (`src/index.ts` = API, `src/internal/` = off-limits, `AGENTS.md` = per-package rules). `apps/` = storybook, docs, integration, sveltekit-fixture. `.workingdir/` = gitignored state (PLAN, STATE, BACKLOG, `research/`).

## Common tasks

Skills: `/wire-module`, `/scaffold-route`, `/add-shadcn`, `/add-storybook`. `make setup` (bootstrap), `make ci` (full CI), `pnpm test:stories` (axe), `pnpm test:e2e`. Root dep: `pnpm add -Dw <dep>`. Package dep: `pnpm --filter @sveltesentio/<pkg> add <dep>`.

## Upstream docs + CI

Pinned snapshots: `docs/upstream/`. Peer ranges: each `packages/*/package.json` `peerDependencies`. PR gates: commitlint, eslint, prettier, tsc, vitest (>=70%, >=85% auth/forms), Playwright, axe-core, `pnpm audit --audit-level=high`, CodeQL. Config: `.github/workflows/ci.yml`. Release: SLSA L2 provenance; L3 open (#280).

## When in doubt

Read: [principles.md](../docs/principles.md) (§2), [ux-principles.md](../docs/ux-principles.md) (§3), per-package `AGENTS.md`, `.workingdir/STATE.md` + `PLAN.md`, `research/decisions-needed.md`.
