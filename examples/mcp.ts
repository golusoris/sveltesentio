// MCP server exposing sveltesentio's compose-recipe + principles knowledge as tools.
import { createSveltesentioServer } from '@sveltesentio/mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

// Registers compose_search / module_lookup / principle_lookup tools + ADR/compose
// resources, rooted at your repo. Point an MCP client (Claude Code) at it over stdio.
const server = createSveltesentioServer({ rootDir: process.cwd() });
await server.connect(new StdioServerTransport());
