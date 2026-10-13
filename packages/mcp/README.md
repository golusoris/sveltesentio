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

## Sub-exports

| Import                                     | What                                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `@sveltesentio/mcp`                        | `createSveltesentioServer`, `createSveltesentioServerWith` — the assembled server        |
| `@sveltesentio/mcp/subscriptions`          | `registerResourceSubscriptions`, `SubscriptionController` — resource subscription wiring |
| `@sveltesentio/mcp/tools/compose-search`   | `registerComposeSearchTool` — registers the compose-search tool on a server              |
| `@sveltesentio/mcp/tools/principle-lookup` | `registerPrincipleLookupTool`, `parseSections` — registers the principle-lookup tool     |

Each tool registers itself onto a server you own, so a host can compose only the
tools it wants rather than taking the whole set.

## Install

The server runs from a checkout of this repository: it reads `docs/` and
`packages/` there. The published package carries the library only, no
executable. In a checkout, with Node 24 or newer:

```bash
pnpm install
pnpm --filter @sveltesentio/mcp start   # stdio server; the client normally starts it
```

To embed the server in your own host instead, add the library and call
`createSveltesentioServer({ rootDir })` with the path of a checkout:

```bash
pnpm add -D @sveltesentio/mcp
```

## Client configuration

Clients start the server with `node` on the entry file in the checkout.
`test/bin.test.ts` starts it the same way and calls `module_lookup` over stdio.

### Claude Code (`claude_desktop_config.json` / `~/.claude/mcp_servers.json`)

```json
{
  "mcpServers": {
    "sveltesentio": {
      "command": "node",
      "args": ["/absolute/path/to/sveltesentio/packages/mcp/bin/sveltesentio-mcp.ts"]
    }
  }
}
```

The server reads the checkout that holds the entry file, three directories up
from `bin/`. Set `SVELTESENTIO_ROOT` in the client's `env` block to read a
different checkout.

### Cursor (`~/.cursor/mcp.json` or workspace `.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "sveltesentio": {
      "command": "node",
      "args": ["/absolute/path/to/sveltesentio/packages/mcp/bin/sveltesentio-mcp.ts"]
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

EUPL-1.2 © lusoris. Releases up to and including 0.2.0 are MIT.
