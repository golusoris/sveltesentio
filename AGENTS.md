<!-- markdownlint-disable MD013 MD025 -->

<!-- markdownlint-disable MD013 -->
# golusoris/sveltesentio Agent Operating Harness

<!-- praetor:head -->

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

5. **No evasion.** Never attempt `--no-verify`, `LEFTHOOK=0`, or modifying `.git/hooks`. Hooks = local gate adoption installs. Adoption adds no server-side `praetorctl` gate run. Scaffolded CI: `.github/workflows/praetor-docs.yml` runs step `Stop on a draft pull request`, `node tools/markdownlint/verify.mjs`, step `Verify figures`.

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

# Repository gate; steps live in Makefile
make verify-all
```

<!-- markdownlint-enable MD013 -->
<!-- markdownlint-disable MD025 -->
<!-- praetor:harness:end -->

---

<!-- markdownlint-disable MD013 -->

# Agent guide — sveltesentio

> Cross-tool context: [Claude Code](https://claude.com/claude-code), [Cursor](https://cursor.sh), [Aider](https://aider.chat), [Codex](https://github.com/openai/codex), [Continue](https://continue.dev), other coding assistants.
> **Read before suggesting changes.** Then read per-subpackage `AGENTS.md` for touched area.

## What this repo is

`sveltesentio` = pnpm workspace monorepo (`github.com/lusoris/sveltesentio`). Wraps pinned set of best-in-class libraries as opt-in `@sveltesentio/*` packages. Apps compose only what they need; nothing else ships.

**SvelteKit analog of [golusoris/golusoris](https://github.com/golusoris/golusoris)** (Go meta-framework, same author). Same opt-in module discipline. Same compliance posture (OWASP ASVS L2 / WCAG 2.2 AA / SLSA L3 / EU CRA / EU AI Act). Same AI-assisted-development conventions (AGENTS.md + CLAUDE.md + Skills + Hooks). Expressed in Svelte 5 runes + TypeScript, not Go + fx.

Pointers: [README.md](README.md) = user-facing pitch. [docs/principles.md](docs/principles.md) = full coding contract (§2). [docs/ux-principles.md](docs/ux-principles.md) = UX rules (§3).

## HISS in this repository

Harness above = rule text. Rows below = TypeScript adaptation + repository enforcement.

- HISS-03 (manual heap management), HISS-09 (pointer arithmetic): no analogue in TypeScript.
- HISS-11..14: tracked by upstream HISS-20 coverage catalog, not asserted here.

| Invariant | Repository rule                                                                                                                                      | Enforced by          |
| :-------- | :--------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------- |
| HISS-01   | No circular imports between `@sveltesentio/*` packages.                                                                                              | `pnpm check:cycles`  |
| HISS-02   | Explicit `AbortSignal` timeout on all I/O.                                                                                                           | ESLint / review      |
| HISS-04   | Function length $\le 60$ LOC, McCabe Cyclomatic $\le 10$, Svelte component $\le 100$ lines.                                                          | ESLint `complexity`  |
| HISS-07   | No non-null `!`, no floating promises, no empty `catch`. All errors flow through `@sveltesentio/core/errors` (RFC 9457).                             | `@typescript-eslint` |
| HISS-08   | No `eval` / `new Function`; no unsanitised `innerHTML`, DOMPurify at every boundary.                                                                 | ESLint / CodeQL      |
| HISS-10   | Zero-warning tolerance across `tsc`, ESLint, Prettier. No `any`.                                                                                     | Exit code 1          |
| HISS-15   | Positive, negative, boundary tests mandatory for every public export.                                                                                | CI coverage gate     |
| HISS-17   | Turn start reads `.workingdir/STATE.md` + `OPEN.md`; turn end runs `praetorctl state sync .`.                                                        | `make state-audit`   |
| HISS-18   | `scripts/ci-affected.mjs` skips unaffected packages; `CI Gate` still reports.                                                                        | Review (runner time) |
| HISS-19   | Upstream libs count as existing code (see streamlining rule).                                                                                        | Review blocker       |
| HISS-20   | `.config/hiss/coverage.yaml` declares enforcement per invariant, per language; `praetorctl hiss coverage --verify` replays fixture corpus both ways. | `make hiss-coverage` |

Gate steps inside `make verify-all`, beside engine checks: `pnpm run ci` (lint, typecheck, test, build, all workspaces); `pnpm check:cycles`; `pnpm audit --audit-level=high` (supply-chain gate CI enforces).

## Hard rules

1. **Never break public API** without `Migration:` footer (before/after Svelte snippet) + codemod, or explicit "manual migration" note with line-level diff guidance. CI runs API-extractor against previous tag.
2. **Never add transitive dependency** without weighing alternatives from awesome-lists harvest (`.workingdir/research/svelte-ecosystem-audit.md`). State choice in PR if non-obvious.
3. **Public surface of every package = `src/index.ts` named exports** (+ documented sub-exports like `ui/toast`, `media/player`). Apps never import internals (anything under `src/internal/` or unexported). Package `exports` map = enforcement gate.
4. **No top-level side effects in package modules.** No `window.` access, no DOM reads, no `setInterval` at import time. Use vite plugins, SvelteKit hooks, or explicit `register(app)` entry points.
5. **All errors flow through `@sveltesentio/core/errors`** (RFC 9457 `application/problem+json` parser + typed `ProblemDetails`). Never throw raw `Error` from package code.
6. **All time uses `@sveltesentio/core/clock`.** `Date.now()` / `new Date()` / `performance.now()` banned in package source outside `test/`. Enforced by custom eslint rule (`eslint.config.js`).
7. **No `console.log` in package source.** `console.warn` / `console.error` only, or structured logger from `@sveltesentio/core/log` once it lands. Enforced by eslint `no-console`.
8. **Svelte 5 runes-first.** Never `$:`, never `writable()` for server state (use `@sveltesentio/query`), never `export let` (use `$props()`). Enforced by eslint-plugin-svelte.
9. **No `any` — ever.** Use `unknown`, narrow with Zod or type guards. Enforced by `@typescript-eslint/no-explicit-any: error`.
10. **Every merged commit: 0 eslint · 0 tsc · 0 `pnpm audit` vulns · axe-clean on stories.** `// eslint-disable-*` requires justification comment on adjacent line.
11. **No guessing on major decisions.** Agents never lock library picks, module surface, API shape, or compliance posture on their own.
    - Agent job: present evidence + ≥ 2 named alternatives, open/update `D*` row in `.workingdir/research/decisions-needed.md`.
    - Only project owner (`@lusoris`) closes `D*` row to `locked (ADR-NNNN)`.
    - Evidence = (a) cited file:line in `golusoris/app-*` repo, (b) measured benchmark / bundle analysis, or (c) existing ADR.
    - Not evidence: "Seems good", "commonly used", awesome-list consensus. Those = pointers to where evidence could be gathered.
12. **Strict SvelteKit universe.** Library picks must be (a) Svelte 5 runes-native with first-class TS types, or (b) framework-agnostic libraries composing cleanly with SvelteKit SSR (TanStack, Zod, Yjs, Vite plugins, ConnectRPC, openapi-fetch, elkjs, etc.).
    - Never pull React/Vue/Solid component libraries via cross-framework bridges: non-Svelte UI dep = architectural smell.
    - Capability exists only outside Svelte ecosystem -> open `D*` row, discuss before adding bridge.

[docs/principles.md](docs/principles.md) holds Power-of-10, OWASP ASVS L2, WCAG 2.2 AA, supply-chain, testing, performance contract. Deviations require PR comment citing subsection.

## Workflow discipline (evidence-driven)

sveltesentio = deliberately **research-first**. Author maintains existing Svelte apps (`golusoris/app-arca`, `app-revenge`, `app-subdo`, `app-lurkarr`). **Those apps = source of truth** for which patterns deserve promotion into framework.

Before proposing new package, sub-export, or API shape, agent must:

1. Check `.workingdir/research/decisions-needed.md`: question already open? Add evidence there, do not ship guess.
2. Check `.workingdir/research/svelte-ecosystem-audit.md`: upstream library already evaluated? Does it obsolete proposed wrapper?
3. Check `.workingdir/research/existing-apps-deepread.md`: pattern observed in ≥ 2 existing apps? One-off patterns stay in their app.
4. No evidence yet: **do research, don't guess.** Open `D*` row in `decisions-needed.md`, wait for evidence.

**Streamlining rule** (2026-04-17): existing library in Svelte / Tailwind / JS ecosystem already solves problem cleanly -> do **not** wrap it into `@sveltesentio/*` package. Document composition pattern in `docs/compose/`; consumers import upstream library directly.

Wrappers justified only when they:

- (a) enforce cross-cutting invariant from `docs/principles.md`, or
- (b) compose multiple libraries into pinned matrix, or
- (c) encode decision otherwise re-litigated per app.

## Repository layout

Full annotated tree: [docs/architecture/repository-layout.md](docs/architecture/repository-layout.md).

| Path               | Holds                                                                                                                                                                                                                    |
| :----------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/<name>/` | `@sveltesentio/*` publishable module, 19 published. `src/index.ts` = entire public API (named exports only); `src/internal/` = off-limits to consumers; `AGENTS.md` = per-package conventions, read before touching area |
| `apps/`            | `storybook` (Storybook 10 showcase, axe via addon-a11y), `docs` (docs site, mdsvex), `integration` (integration-test app consuming every published package)                                                              |
| `examples/`        | 19 per-package canonical usage snippets + README                                                                                                                                                                         |
| `docs/`            | `principles.md` (§2), `ux-principles.md` (§3), `adr/`, `architecture/`, `migrations/`, `compliance/`, `compose/`, `upstream/`                                                                                            |
| `.claude/`         | `settings.json` hooks; skills `/wire-module`, `/scaffold-route`, `/add-shadcn`, `/add-storybook`                                                                                                                         |
| `.github/`         | CODEOWNERS, issue + PR templates, workflows (see "CI gates")                                                                                                                                                             |
| `.workingdir/`     | local-only planning state, gitignored: PLAN, STATE, V0.1.0, BACKLOG; `research/` = per-library audits, app deep-reads, D-row decision ledger                                                                             |

Sub-exports (`ui/toast`, `media/player`, …) = module subpaths, not directories. Per-subpackage `AGENTS.md` files give package-level conventions, idioms, pinned doc URLs. Create one per package when its Phase lands (not before).

## Package purpose table

| Package                     | Phase | Key dependencies                                                                           | What it provides                                                                                                                                                                                                                                  |
| --------------------------- | ----- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@sveltesentio/core`        | 2     | vite, zod, openapi-fetch                                                                   | env schema, RFC 9457 error parser, id/clock utils, CSP helpers, vite plugin                                                                                                                                                                       |
| `@sveltesentio/api`         | 4     | openapi-fetch, openapi-typescript (optional)                                               | typed openapi-fetch client + RFC 9457 `problemMiddleware` + codegen recipe                                                                                                                                                                        |
| `@sveltesentio/ui`          | 3     | shadcn-svelte, bits-ui, tailwindcss@4, mode-watcher                                        | Tailwind preset, oklch tokens, shadcn CLI wrapper, interface-type presets, headless DataTable/command/toast                                                                                                                                       |
| `@sveltesentio/query`       | 4     | @tanstack/svelte-query                                                                     | load helpers, optimistic updates, SSR hydration, pagination                                                                                                                                                                                       |
| `@sveltesentio/forms`       | 5     | sveltekit-superforms, zod                                                                  | form patterns, field components, action helpers, error mapping                                                                                                                                                                                    |
| `@sveltesentio/i18n`        | 6     | @inlang/paraglide-js                                                                       | locale detection, message helpers, SvelteKit middleware, RTL                                                                                                                                                                                      |
| `@sveltesentio/auth`        | 7     | openid-client, @simplewebauthn/browser                                                     | OIDC/session client, passkeys, permission runes, TOTP MFA                                                                                                                                                                                         |
| `@sveltesentio/realtime`    | 8     | sveltekit-sse, @connectrpc/connect-web                                                     | SSE + ConnectRPC + WebSocket transport adapter                                                                                                                                                                                                    |
| `@sveltesentio/collab`      | 8b    | yjs, y-websocket, y-indexeddb                                                              | CRDT + Svelte binding + sync provider                                                                                                                                                                                                             |
| `@sveltesentio/flow`        | 9     | @xyflow/svelte                                                                             | node editor wrappers, DAG helpers, canvas utilities                                                                                                                                                                                               |
| `@sveltesentio/uploads`     | 9b    | tus-js-client, exifr, file-type                                                            | resumable uploads + presigned S3 + client-side guards                                                                                                                                                                                             |
| `@sveltesentio/media`       | 10    | vidstack, hls.js, embla-carousel-svelte                                                    | player/image/game sub-exports                                                                                                                                                                                                                     |
| `@sveltesentio/emulator`    | 10    | (EmulatorJS — external/CDN)                                                                | EmulatorJS Svelte loader + CSP directives for wasm/worker                                                                                                                                                                                         |
| `@sveltesentio/shell`       | 10b   | (TBD — see D140..D143)                                                                     | device-class layouts, D-pad routing, PWA install                                                                                                                                                                                                  |
| `@sveltesentio/charts`      | 11    | layerchart                                                                                 | dashboard chart wrappers, semantic color presets                                                                                                                                                                                                  |
| `@sveltesentio/ai`          | 12    | @anthropic-ai/sdk (server), @huggingface/transformers, ollama-js (proxy)                   | LLM chat streaming, edge AI, semantic search, audit hook                                                                                                                                                                                          |
| `@sveltesentio/ipc-sockmap` | 12b   | @sveltesentio/core (Linux server-only; Tier 3 reads pinned BPF sockmap owned by golusoris) | Colocated SvelteKit ↔ Golusoris IPC — AF_UNIX (Tier 1) + framing + transport-ladder detection; eBPF SK_MSG (Tier 3) observe/handoff via `./sockmap` (probeSockmap + activationListeners + readSockmapStats); golusoris owns map writes (ADR-0051) |
| `@sveltesentio/testing`     | ortho | vitest (optional peer), @axe-core/playwright                                               | `testClock({ now })` (ADR-0052), a11y harness (ADR-0031), Superforms + TanStack Query fixtures                                                                                                                                                    |
| `@sveltesentio/mcp`         | ortho | @modelcontextprotocol/sdk                                                                  | MCP server exposing ADR/compose/compliance docs + module-lookup tool to Claude Code / Cursor / Aider / Codex / Continue                                                                                                                           |

**All 19 packages above: built + published to npm as of v0.1.0 milestone (see `.workingdir/V0.1.0.md`). Phase column records original build order, not pending work.**

Deferred to post-v0.1.0: `observability`, `notify`, `page`, `outbox`, `leader`, `pdf`, `ocr`, `search`, `fs`, `payments`. Full golusoris cross-reference: `.workingdir/research/module-backlog.md`.

## Common tasks

| Task                                                     | Command / Skill                                                                                            |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Add a new `@sveltesentio/*` package                      | `/wire-module` skill                                                                                       |
| Scaffold a SvelteKit route (Superforms + TanStack Query) | `/scaffold-route` skill                                                                                    |
| Add a shadcn-svelte component                            | `/add-shadcn` skill                                                                                        |
| Add a Storybook story                                    | `/add-storybook` skill                                                                                     |
| Bootstrap dev environment                                | `make setup`                                                                                               |
| Run full CI locally                                      | `make ci`                                                                                                  |
| Add a new root-level dep                                 | `pnpm add -Dw <dep>`                                                                                       |
| Add a workspace-package dep                              | `pnpm --filter @sveltesentio/<pkg> add <dep>`                                                              |
| Create release PR                                        | (automated by release-please — open a branch + Conventional-Commit PR; `release-please.yml` runs on merge) |

## Pinned upstream docs

Version-pinned snapshots live in `docs/upstream/` (maintained by `refresh-upstream-docs.yml`). Library not yet snapshotted -> check library repo directly for exact version in `pnpm-lock.yaml`. Public docs may be ahead of or behind pinned version.

Current peer-range targets (consumers must satisfy these):

| Package                  | Version target | Notes                                          |
| ------------------------ | -------------- | ---------------------------------------------- |
| `svelte`                 | ^5.55.4        | runes-first; no Svelte 4 compat                |
| `@sveltejs/kit`          | ^2.x           | exact minimum TBD in D5                        |
| `vite`                   | ^5 or ^6       | TBD — depends on rolldown timing               |
| `typescript`             | ^6.0.3         | ADR-0020; published peerDep `>=5.5 <7`         |
| `zod`                    | ^4             | v3 unsupported                                 |
| `tailwindcss`            | ^4             | v3 unsupported; preset compatible only with v4 |
| `@tanstack/svelte-query` | ^6             | ADR-0008                                       |
| `node`                   | >=24           | ADR-0021; LTS; closes D5                       |
| `pnpm`                   | >=10           | workspace features required                    |

## CI gates

Every PR must pass:

- **Conventional Commits** PR title (`commitlint` via `ci.yml`).
- **ESLint flat config**: 0 errors (TS + Svelte + a11y).
- **Prettier**: formatted (checked; not auto-fixed in CI).
- **TypeScript**: 0 errors across workspaces (`turbo typecheck`).
- **Vitest**: green + ≥ 70% coverage (≥ 85% for `auth`, `forms`).
- **Playwright**: e2e green (via `apps/integration`).
- **axe-core**: clean on every Storybook story (via `@storybook/addon-a11y`).
- **`pnpm audit`**: clean (no `>=high` advisories).
- **`codeql.yml`**: clean.
- **`scorecard.yml`**: score ≥ 7.

Release PRs additionally:

- **SLSA provenance**: Build Level 2 via `actions/attest-build-provenance` in `release-please.yml`.
- **SBOM**: CycloneDX, workflow artifact only.
- **Open (#280)**: Level 3, cosign, npm provenance, SBOM on release. Exception `HISS-11` in `.standards.yaml`, expires 2027-01-09.

## When in doubt

1. Read [docs/principles.md](docs/principles.md): coding/security/compliance contract (§2).
2. Read [docs/ux-principles.md](docs/ux-principles.md): UI/UX rules per interface type (§3).
3. Read per-subpackage `AGENTS.md` for touched area.
4. Read `.workingdir/STATE.md`: current author work + locked decisions.
5. Read `.workingdir/PLAN.md`: full roadmap + framework mission.
6. Decision not locked yet -> check `.workingdir/research/decisions-needed.md`, **add evidence, don't ship guess**.
