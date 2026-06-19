import {
  SubscribeRequestSchema,
  UnsubscribeRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Tracks per-server resource subscriptions and relays `resources/updated`
 * notifications. The MCP SDK's high-level `McpServer` wires `resources/list`,
 * `resources/read`, and the templated variants, but not the subscribe pair —
 * we add those here and advertise the `resources.subscribe` capability so
 * clients may opt in to change notifications.
 */
export interface SubscriptionController {
  /** URIs the connected client has an active subscription for. */
  readonly subscriptions: ReadonlySet<string>;
  /** Notify the client that `uri` changed (no-op if it isn't subscribed). */
  notifyResourceUpdated(uri: string): Promise<void>;
}

export function registerResourceSubscriptions(server: McpServer): SubscriptionController {
  const subscriptions = new Set<string>();

  server.server.registerCapabilities({ resources: { subscribe: true } });

  server.server.setRequestHandler(SubscribeRequestSchema, (request) => {
    subscriptions.add(request.params.uri);
    return {};
  });

  server.server.setRequestHandler(UnsubscribeRequestSchema, (request) => {
    subscriptions.delete(request.params.uri);
    return {};
  });

  return {
    get subscriptions(): ReadonlySet<string> {
      return subscriptions;
    },
    async notifyResourceUpdated(uri: string): Promise<void> {
      if (!subscriptions.has(uri)) {
        return;
      }
      await server.server.sendResourceUpdated({ uri });
    }
  };
}
