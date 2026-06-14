import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAdrResource } from './resources/adr.js';
import { registerComposeResource } from './resources/compose.js';
import { registerComplianceResource } from './resources/compliance.js';
import { registerModuleLookupTool } from './tools/module-lookup.js';

export interface ServerOptions {
  rootDir: string;
  name?: string;
  version?: string;
}

export function createSveltesentioServer(opts: ServerOptions): McpServer {
  const server = new McpServer({
    name: opts.name ?? 'sveltesentio',
    version: opts.version ?? '0.0.1'
  });

  registerAdrResource(server, opts.rootDir);
  registerComposeResource(server, opts.rootDir);
  registerComplianceResource(server, opts.rootDir);
  registerModuleLookupTool(server, opts.rootDir);

  return server;
}
