# @sveltesentio/mcp

> Model Context Protocol server exposing sveltesentio's module catalog, ADR index, compose recipes, and compliance checklists to AI coding assistants.

Part of the [sveltesentio](https://github.com/golusoris/sveltesentio) composable SvelteKit framework.

## Status

v0.2.0 — built and published. Exposes the module catalog, ADR/compose/compliance resources, the `module_lookup` / `compose_search` / `principle_lookup` tools, and resource subscriptions.

## What it does

When wired into a Claude Code / Cursor / Aider / Codex / Continue session, the server gives the agent structured access to:

| Resource URI                 | Content                                            |
| ---------------------------- | -------------------------------------------------- |
| `adr://index`                | The ADR index (`docs/adr/README.md`)               |
| `adr://0052`                 | Individual ADR by number (zero-padded to 4 digits) |
| `compose://index`            | List of compose recipes                            |
| `compose://clock-injection`  | A specific compose recipe                          |
| `compliance://index`         | List of compliance checklists                      |
| `compliance://owasp-asvs-l2` | A specific compliance checklist                    |

| Tool                                | Purpose                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| `module_lookup({ name })`           | Return the `AGENTS.md` + `package.json` sub-exports for `@sveltesentio/<name>` |
| `compose_search({ query, limit? })` | Rank compose recipes by keyword and return the matching snippets               |
| `principle_lookup({ query })`       | Return a principle by `§N.M` id or keyword from `docs/principles.md`           |

Clients that support it can also subscribe to resource URIs and receive change notifications via the advertised `resources.subscribe` capability.

The server is **read-only** — no shell-outs, no mutations, no network calls. Output is always a doc snippet or instruction text the agent can act on.

## Install

```bash
pnpm add -D @sveltesentio/mcp
```

The `sveltesentio-mcp` binary is wired automatically; the client spawns it over stdio.

## Client configuration

### Claude Code (`claude_desktop_config.json` / `~/.claude/mcp_servers.json`)

```json
{
  "mcpServers": {
    "sveltesentio": {
      "command": "pnpm",
      "args": ["exec", "sveltesentio-mcp"],
      "env": {
        "SVELTESENTIO_ROOT": "/absolute/path/to/sveltesentio/checkout"
      }
    }
  }
}
```

`SVELTESENTIO_ROOT` is optional — when omitted the binary resolves the workspace root relative to its own location inside `node_modules/@sveltesentio/mcp/bin/`.

### Cursor (`~/.cursor/mcp.json` or workspace `.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "sveltesentio": {
      "command": "pnpm",
      "args": ["exec", "sveltesentio-mcp"]
    }
  }
}
```

### Aider / Codex / Continue

These clients consume the same JSON config shape; consult their respective docs for the per-tool config file location.

## Verifying

After registering the server, ask the agent to "look up the @sveltesentio/core module via MCP" — it should call the `module_lookup` tool and return the package's `AGENTS.md` + sub-export block. If the agent never calls a tool, the MCP server is not registered (check the client logs).

## Scope deliberately small

- No write operations — the server cannot scaffold files. Use the `.claude/skills/` (Claude Code) or equivalent in your client for that.
- No network calls — all data comes from the in-tree `docs/` and `packages/` directories.
- No transport beyond stdio for now — HTTP/SSE may follow when a remote use-case appears.

See [AGENTS.md](AGENTS.md) for design invariants and the planned follow-through.

## License

MIT © lusoris
