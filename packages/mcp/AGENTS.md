# @sveltesentio/mcp — AGENTS.md

> Standalone MCP (Model Context Protocol) server exposing sveltesentio module catalog, ADR index, compose recipes, compliance checklists to AI coding assistants (Claude Code, Cursor, Aider, Codex, Continue). Phase 1b finishing per `.workingdir/PLAN.md` §6.

## Scope

- **Resources** — read-only, content-addressed views of in-tree documentation:
  - `adr://index` + `adr://<NNNN>` — ADR README + individual ADRs from `docs/adr/`
  - `compose://index` + `compose://<slug>` — compose recipes from `docs/compose/`
  - `compliance://index` + `compliance://<slug>` — checklists from `docs/compliance/`
- **Tools** — agent-invokable functions:
  - `module_lookup({ name })` — return package `AGENTS.md` + sub-export shape from `packages/<name>/`

Server **read-only**. Never mutates working tree. Output always doc snippet or structured instruction-to-the-agent.

## Sub-exports

| Export                                     | Module                                                           | Status          |
| ------------------------------------------ | ---------------------------------------------------------------- | --------------- |
| `@sveltesentio/mcp`                        | `src/index.ts` — `createSveltesentioServer({ rootDir })` factory | shipped (0.2.0) |
| `sveltesentio-mcp` (bin)                   | `bin/sveltesentio-mcp.ts` — stdio entrypoint                     | shipped (0.2.0) |
| `@sveltesentio/mcp/tools/compose-search`   | `src/tools/compose-search.ts` — `compose_search` tool            | shipped (0.2.0) |
| `@sveltesentio/mcp/tools/principle-lookup` | `src/tools/principle-lookup.ts` — `principle_lookup` tool        | shipped (0.2.0) |
| `@sveltesentio/mcp/subscriptions`          | `src/subscriptions.ts` — resource subscription wiring            | shipped (0.2.0) |

## Invariants

- **Read-only.** No tool may write, delete, or invoke network call. New tools violating this rejected at review.
- **No shell-out.** Tools must not exec arbitrary commands — return instructions to agent instead (mirrors golusoris-mcp rule, see `cmd/golusoris-mcp/AGENTS.md`).
- **Workspace-relative paths.** Server resolves paths from `rootDir` (CLI default: workspace root via `..` resolution; override via `SVELTESENTIO_ROOT` env). Never escape workspace.
- **No `any`.** Validate tool input with Zod (`@sveltesentio/forms` pattern). Resource URIs templated via SDK URI parser.
- **ESM-only** (ADR-0022). **Node ≥ 24** (ADR-0021). Stdio transport supported transport; HTTP/SSE may be added later if real use-case appears.

## Test policy

- Unit tests live in `src/**/*.test.ts` (Vitest). Mock filesystem with `memfs` or fixture directories under `test/fixtures/`.
- Each resource handler must have "missing file" test (server must surface structured error, not crash transport).
- `module_lookup` tool must reject names escaping `packages/` root.

## Known follow-through

- [x] `compose_search({ query })` tool — full-text search across `docs/compose/`. Ships as `./tools/compose-search` in 0.2.0.
- [x] `principle_lookup({ section })` tool — return single section of `docs/principles.md` keyed by `§2.X`. Ships as `./tools/principle-lookup` in 0.2.0.
- [x] Resource subscriptions — notify subscribed clients when ADR/recipe file changes. Ships as `./subscriptions` in 0.2.0.
- [ ] HTTP/SSE transport for remote/multi-tenant use-cases. Do not add until concrete consumer appears (YAGNI).

## Common tasks

| Task               | Command                                     |
| ------------------ | ------------------------------------------- |
| Run server (stdio) | `pnpm --filter @sveltesentio/mcp start`     |
| Typecheck          | `pnpm --filter @sveltesentio/mcp typecheck` |
| Unit tests         | `pnpm --filter @sveltesentio/mcp test`      |
| Lint               | `pnpm --filter @sveltesentio/mcp lint`      |

## Related references

- [README.md](README.md) — client config snippets (`claude_desktop_config.json`, Cursor `mcp.json`).
- [docs/adr/](../../docs/adr/) — ADR corpus exposed as `adr://` resources.
- [docs/compose/](../../docs/compose/) — compose recipes exposed as `compose://` resources.
- [docs/compliance/](../../docs/compliance/) — checklists exposed as `compliance://` resources.
- Upstream: <https://modelcontextprotocol.io> · <https://github.com/modelcontextprotocol/typescript-sdk>
- Reference implementation: `golusoris/cmd/golusoris-mcp/` (Go; HTTP-transport variant).
