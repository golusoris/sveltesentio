import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResourceUpdatedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { SubscriptionController } from '../src/index.js';
import { connectClientWith, repoRoot } from './helpers.js';

describe('resource subscriptions', () => {
	let client: Client | undefined;

	afterEach(async () => {
		await client?.close();
		client = undefined;
	});

	it('advertises the subscribe capability to the client', async () => {
		const conn = await connectClientWith(repoRoot);
		client = conn.client;
		expect(client.getServerCapabilities()?.resources?.subscribe).toBe(true);
	});

	it('tracks a subscribe call and an unsubscribe call on the controller', async () => {
		const conn = await connectClientWith(repoRoot);
		client = conn.client;
		const controller: SubscriptionController = conn.subscriptions;

		expect([...controller.subscriptions]).toEqual([]);

		await client.subscribeResource({ uri: 'compose://index' });
		expect([...controller.subscriptions]).toEqual(['compose://index']);

		await client.unsubscribeResource({ uri: 'compose://index' });
		expect([...controller.subscriptions]).toEqual([]);
	});

	it('delivers a resources/updated notification for a subscribed uri', async () => {
		const conn = await connectClientWith(repoRoot);
		client = conn.client;

		const received = vi.fn();
		client.setNotificationHandler(ResourceUpdatedNotificationSchema, (note) => {
			received(note.params.uri);
		});

		await client.subscribeResource({ uri: 'adr://index' });
		await conn.subscriptions.notifyResourceUpdated('adr://index');

		await vi.waitFor(() => {
			expect(received).toHaveBeenCalledWith('adr://index');
		});
	});

	it('does not notify for a uri that was never subscribed', async () => {
		const conn = await connectClientWith(repoRoot);
		client = conn.client;

		const received = vi.fn();
		client.setNotificationHandler(ResourceUpdatedNotificationSchema, () => {
			received();
		});

		await conn.subscriptions.notifyResourceUpdated('adr://index');
		// give any erroneous notification a chance to land
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(received).not.toHaveBeenCalled();
	});
});
