<!-- markdownlint-disable MD013 MD025 -->

<!-- markdownlint-disable MD013 -->
# golusoris/sveltesentio Agent Operating Harness

Run read-only: file edits, state mutations, commits prohibited. Mutating steps dropped; prohibitions kept.

<!-- praetor:head -->

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
| **HISS-17** state ledger | turn start `praetorctl state status` | read-only run: step dropped | none; records only |
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

<!-- praetor:config -->

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

<!-- praetor:tail -->

## Primary Verification Commands

```bash
# Fast local test suite
# Declared commands only; run them before claiming application verification.
'make' 'verify-all'

# Recompile and verify cross-agent context outputs
praetorctl compile-context --verify

# Audit repository against declared HISS standards
praetorctl audit
```

<!-- markdownlint-enable MD013 -->
<!-- markdownlint-disable MD025 -->
<!-- praetor:harness:end -->

---

# Agent guide — sveltesentio

> For Claude Code, Cursor, Aider, Codex, Continue. Read before changes; then per-package `AGENTS.md`.

## What this repo is

`sveltesentio` = pnpm monorepo (`github.com/lusoris/sveltesentio`). Opt-in `@sveltesentio/*` modules (Svelte 5 runes + TS). SvelteKit analog of `golusoris/golusoris` (OWASP ASVS L2, WCAG 2.2 AA, SLSA Build Level 2, Level 3 open #280, EU CRA, EU AI Act).
Pitch: [README.md](README.md).

## HISS in this repository

TypeScript: HISS-03/09 n/a; HISS-11..14 in upstream catalog.

| HISS | Rule | Check |
|:---|:---|:---|
| 01 | No package cycles | `pnpm check:cycles` |
| 02 | `AbortSignal` on I/O | ESLint/review |
| 04 | <=60 LOC, McCabe <=10, component <=100 | ESLint |
| 07 | No `!`, unhandled promises, empty catch | `@typescript-eslint` |
| 08 | No `eval`/`new Function`/unsanitised `innerHTML`; DOMPurify | ESLint/CodeQL |
| 10 | 0 warnings, no `any` | Exit 1 |
| 15 | Each export named in a test; 3 cases = review | `pnpm check:export-tests` |
| 17 | State read/sync | read-only run: step dropped |
| 18 | Diff-aware on PR, full otherwise | `CI Gate` |
| 19 | Upstream libs = existing code | Review |
| 20 | Coverage verified | `make hiss-coverage` |
| 21 | Linux/macOS/Windows legs required (#328) | `portability.yml` |

Gate: `pnpm run ci`, `pnpm check:cycles`, `pnpm check:declared-imports`, `pnpm audit --audit-level=high`.

## Hard rules

1. Append-only API; breaking change needs `Migration:` footer (before/after snippet) + codemod or line-level manual-migration note; no API-diff gate yet (#288): reviewer diffs surface.
2. No new transitive dep without weighing alternatives in `.workingdir/research/svelte-ecosystem-audit.md`; non-obvious pick -> justify in PR.
3. Public surface = `src/index.ts` named exports (+ `ui/toast` subpaths); apps never import `src/internal/`; `exports` enforces.
4. No top-level side effects (no `window.`, DOM reads, import `setInterval`); use vite plugins, hooks, `register(app)`.
5. Errors via `@sveltesentio/core/errors` (RFC 9457 `ProblemDetails`); never throw raw `Error`.
6. Time via `@sveltesentio/core/clock`; banned outside `test/`: `Date.now()`, `new Date()`, `performance.now()` (eslint).
7. Zero `console.log` (warn/error only, or `@sveltesentio/core/log`; eslint `no-console`).
8. Svelte 5 runes-first: no `$:`, no `writable()` for server state (`@sveltesentio/query`), no `export let` (`$props()`; eslint).
9. Zero `any`: use `unknown`, narrow via Zod/type guards (`@typescript-eslint/no-explicit-any`).
10. Merged commit: 0 eslint, 0 tsc, 0 audit vulns, axe-clean stories; `// eslint-disable-*` needs adjacent justification.
11. Agents never lock library picks, module surface, API shape, compliance posture. Open/update `D*` in `.workingdir/research/decisions-needed.md` with evidence + >= 2 options; owner (`@lusoris`) closes to `locked (ADR-NNNN)`; evidence = app line, benchmark, ADR; consensus != evidence.
12. SvelteKit universe: runes-native + TS types or framework-agnostic (TanStack, Zod, Yjs, Vite, ConnectRPC, openapi-fetch, elkjs); no React/Vue/Solid bridges; external capability needs `D*` row.

## Workflow discipline

Research-first; apps = truth for promotion (`.workingdir/research/deepread-*.md`, `.workingdir/PLAN.md`).
Before proposing package, sub-export, API:
1. `.workingdir/research/decisions-needed.md`: open question? Add evidence, do not guess.
2. `.workingdir/research/svelte-ecosystem-audit.md`: evaluated? Obsoletes wrapper?
3. `.workingdir/research/existing-apps-deepread.md`: pattern in >= 2 apps? Single-app stays local.
4. No evidence: research; open `D*` row.

Streamlining: clean upstream lib -> do not wrap; document in `docs/compose/`; consumer imports upstream. Wrappers: (a) enforce invariant from `docs/principles.md`, (b) compose libs into matrix, (c) encode cross-app decision.

## References

- Layout: [repository-layout.md](docs/architecture/repository-layout.md); sub-exports = module subpaths.
- Packages (19 published): [packages.md](docs/architecture/packages.md); backlog `.workingdir/research/module-backlog.md`.
- Tasks: [common-tasks.md](docs/contributing/common-tasks.md).
- Peers: [peer-ranges.md](docs/upstream/peer-ranges.md), `docs/upstream/`.

## CI gates

PR: Conventional Commits, 0 ESLint errors, Prettier, 0 `turbo typecheck` errors, Vitest green + >= 70% coverage (>= 85% `auth`, `forms`), Playwright e2e green (`auth`, `media`, `shell`), axe-core clean (ADR-0056), `pnpm audit` clean, `codeql.yml` clean.

Release: SLSA Build Level 2, CycloneDX SBOM; Level 3 open (#280, exception `HISS-11`). Details: [ci-gates.md](docs/contributing/ci-gates.md).

Deviation from [principles.md](docs/principles.md) (§2) or [ux-principles.md](docs/ux-principles.md) (§3): PR comment cites subsection. Unsure: per-package `AGENTS.md`, `.workingdir/STATE.md`, `PLAN.md`.
