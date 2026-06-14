import { describe, it, expect } from 'vitest';
import type { ELK, ElkNode } from 'elkjs/lib/elk-api.js';
import { createElkLayout, type ElkFactory } from '../src/layout.js';

function fakeElkFactory(): ElkFactory {
	const elk: ELK = {
		async layout(graph: ElkNode): Promise<ElkNode> {
			let y = 0;
			const children = (graph.children ?? []).map((c) => {
				const node: ElkNode = {
					id: c.id,
					x: 0,
					y,
					width: c.width ?? 0,
					height: c.height ?? 0,
				};
				y += (c.height ?? 0) + 80;
				return node;
			});
			return {
				id: graph.id,
				children,
				width: 200,
				height: y,
			};
		},
		async knownLayoutAlgorithms() {
			return [];
		},
		async knownLayoutOptions() {
			return [];
		},
		async knownLayoutCategories() {
			return [];
		},
		terminateWorker(): void {},
	};
	return async () => elk;
}

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
		const factory: ElkFactory = async () => ({
			async layout(graph: ElkNode): Promise<ElkNode> {
				return { id: graph.id, children: [], width: 0, height: 0 };
			},
			async knownLayoutAlgorithms() {
				return [];
			},
			async knownLayoutOptions() {
				return [];
			},
			async knownLayoutCategories() {
				return [];
			},
			terminateWorker(): void {},
		});
		const layout = createElkLayout({}, factory);
		const result = await layout([{ id: 'a', width: 50, height: 20 }], []);
		expect(result.nodes[0]).toEqual({ id: 'a', x: 0, y: 0, width: 50, height: 20 });
	});

	it('merges user layoutOptions over defaults', async () => {
		let captured: Record<string, string> | undefined;
		const factory: ElkFactory = async () => ({
			async layout(graph: ElkNode): Promise<ElkNode> {
				captured = graph.layoutOptions;
				return { id: graph.id, children: [] };
			},
			async knownLayoutAlgorithms() {
				return [];
			},
			async knownLayoutOptions() {
				return [];
			},
			async knownLayoutCategories() {
				return [];
			},
			terminateWorker(): void {},
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
