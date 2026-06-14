# @sveltesentio/mcp — AGENTS.md

> Standalone MCP (Model Context Protocol) server that exposes the sveltesentio module catalog, ADR index, compose recipes, and compliance checklists to AI coding assistants (Claude Code, Cursor, Aider, Codex, Continue). Phase 1b finishing per [.workingdir/PLAN.md](../../.workingdir/PLAN.md) §6.

## Scope

- **Resources** — read-only, content-addressed views of in-tree documentation:
  - `adr://index` + `adr://<NNNN>` — ADR README + individual ADRs from `docs/adr/`
  - `compose://index` + `compose://<slug>` — compose recipes from `docs/compose/`
  - `compliance://index` + `compliance://<slug>` — checklists from `docs/compliance/`
- **Tools** — agent-invokable functions:
  - `module_lookup({ name })` — return the package's `AGENTS.md` + sub-export shape from `packages/<name>/`

The server is **read-only**. It never mutates the working tree. Output is always either a doc snippet or a structured instruction-to-the-agent.

## Sub-exports

| Export | Module | Status |
|---|---|---|
| `@sveltesentio/mcp` | `src/index.ts` — `createSveltesentioServer({ rootDir })` factory | v0.0.x stub |
| `sveltesentio-mcp` (bin) | `bin/sveltesentio-mcp.ts` — stdio entrypoint | v0.0.x stub |

## Invariants

- **Read-only.** No tool may write, delete, or invoke a network call. New tools that violate this are rejected at review.
- **No shell-out.** Tools must not exec arbitrary commands — return instructions to the agent instead (mirrors the golusoris-mcp rule, see `cmd/golusoris-mcp/AGENTS.md`).
- **Workspace-relative paths.** The server resolves paths from `rootDir` (CLI default: workspace root via `..` resolution; override via `SVELTESENTIO_ROOT` env). Never escape the workspace.
- **No `any`.** Validate tool input with Zod (`@sveltesentio/forms` pattern). Resource URIs are templated via the SDK's URI parser.
- **ESM-only** (ADR-0022). **Node ≥ 24** (ADR-0021). Stdio transport is the supported transport; HTTP/SSE may be added later if a real use-case appears.

## Test policy

- Unit tests live in `src/**/*.test.ts` (Vitest). Mock the filesystem with `memfs` or fixture directories under `test/fixtures/`.
- Each resource handler must have a "missing file" test (the server must surface a structured error, not crash the transport).
- The `module_lookup` tool must reject names that escape the `packages/` root.

## Known follow-through

- [ ] `compose_search({ query })` tool — full-text search across `docs/compose/`. Defer until the compose corpus stabilises post-v0.1.
- [ ] `principle_lookup({ section })` tool — return a single section of `docs/principles.md` keyed by `§2.X`.
- [ ] Resource subscriptions — notify subscribed clients when an ADR/recipe file changes (SDK supports it; needs a watcher).
- [ ] HTTP/SSE transport for remote/multi-tenant use-cases. Do not add until a concrete consumer appears (YAGNI).

## Common tasks

| Task | Command |
|---|---|
| Run the server (stdio) | `pnpm --filter @sveltesentio/mcp start` |
| Typecheck | `pnpm --filter @sveltesentio/mcp typecheck` |
| Unit tests | `pnpm --filter @sveltesentio/mcp test` |
| Lint | `pnpm --filter @sveltesentio/mcp lint` |

## Related references

- [README.md](README.md) — client config snippets (`claude_desktop_config.json`, Cursor `mcp.json`).
- [docs/adr/](../../docs/adr/) — ADR corpus exposed as `adr://` resources.
- [docs/compose/](../../docs/compose/) — compose recipes exposed as `compose://` resources.
- [docs/compliance/](../../docs/compliance/) — checklists exposed as `compliance://` resources.
- Upstream: https://modelcontextprotocol.io · https://github.com/modelcontextprotocol/typescript-sdk
- Reference implementation: `golusoris/cmd/golusoris-mcp/` (Go; HTTP-transport variant).
