import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAdrResource } from './resources/adr.js';
import { registerComposeResource } from './resources/compose.js';
import { registerComplianceResource } from './resources/compliance.js';
import { registerModuleLookupTool } from './tools/module-lookup.js';
import { registerComposeSearchTool } from './tools/compose-search.js';
import { registerPrincipleLookupTool } from './tools/principle-lookup.js';
import { registerResourceSubscriptions } from './subscriptions.js';
import type { SubscriptionController } from './subscriptions.js';

export interface ServerOptions {
  rootDir: string;
  name?: string;
  version?: string;
}

export function createSveltesentioServer(opts: ServerOptions): McpServer {
  return createSveltesentioServerWith(opts).server;
}

/**
 * Build the server plus its subscription controller. Use this when you need to
 * push `resources/updated` notifications (e.g. a file watcher); the bare
 * {@link createSveltesentioServer} factory is enough for read-only consumers.
 */
export function createSveltesentioServerWith(opts: ServerOptions): {
  server: McpServer;
  subscriptions: SubscriptionController;
} {
  const server = new McpServer({
    name: opts.name ?? 'sveltesentio',
    version: opts.version ?? '0.0.1'
  });

  registerAdrResource(server, opts.rootDir);
  registerComposeResource(server, opts.rootDir);
  registerComplianceResource(server, opts.rootDir);
  registerModuleLookupTool(server, opts.rootDir);
  registerComposeSearchTool(server, opts.rootDir);
  registerPrincipleLookupTool(server, opts.rootDir);
  const subscriptions = registerResourceSubscriptions(server);

  return { server, subscriptions };
}

export type { SubscriptionController } from './subscriptions.js';
