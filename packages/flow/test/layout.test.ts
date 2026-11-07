import { describe, it, expect } from 'vitest';
import type { ElkNode } from 'elkjs/lib/elk-api.js';
import { createElkLayout, type ElkFactory } from '../src/layout.js';
import { fakeElkFactory } from './fake-elk.js';

describe('createElkLayout', () => {
	it('positions nodes using the injected factory and returns edges unchanged', async () => {
		const layout = createElkLayout({ algorithm: 'layered' }, fakeElkFactory());
		const nodes = [
			{ id: 'a', width: 100, height: 40 },
			{ id: 'b', width: 100, height: 40 },
		];
		const edges = [{ source: 'a', target: 'b' }];
		const result = await layout(nodes, edges);
		expect(result.nodes).toHaveLength(2);
		expect(result.nodes[0]).toMatchObject({ id: 'a', x: 0, y: 0 });
		expect(result.nodes[1]).toMatchObject({ id: 'b', y: 120 });
		expect(result.edges).toEqual(edges);
		expect(result.width).toBe(200);
	});

	it('falls back to {x:0,y:0} when the factory omits a node', async () => {
		const factory: ElkFactory = () =>
			Promise.resolve({
				layout(graph: ElkNode): Promise<ElkNode> {
					return Promise.resolve({ id: graph.id, children: [], width: 0, height: 0 });
				},
			});
		const layout = createElkLayout({}, factory);
		const result = await layout([{ id: 'a', width: 50, height: 20 }], []);
		expect(result.nodes[0]).toEqual({ id: 'a', x: 0, y: 0, width: 50, height: 20 });
	});

	it('merges user layoutOptions over defaults', async () => {
		let captured: Record<string, string> | undefined;
		const factory: ElkFactory = () =>
			Promise.resolve({
				layout(graph: ElkNode): Promise<ElkNode> {
					captured = graph.layoutOptions;
					return Promise.resolve({ id: graph.id, children: [] });
				},
			});
		const layout = createElkLayout(
			{ algorithm: 'force', layoutOptions: { 'elk.spacing.nodeNode': '40' } },
			factory,
		);
		await layout([], []);
		expect(captured?.['elk.algorithm']).toBe('force');
		expect(captured?.['elk.spacing.nodeNode']).toBe('40');
	});
});
