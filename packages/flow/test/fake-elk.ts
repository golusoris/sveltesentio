import type { ElkNode } from 'elkjs/lib/elk-api.js';
import type { ElkFactory, ElkLike } from '../src/layout.js';

/**
 * A deterministic ELK double for the layout tests: stacks the children
 * top-to-bottom with an 80 px gap, so positions are known without real elkjs.
 */
export function fakeElkFactory(): ElkFactory {
	const elk: ElkLike = {
		layout(graph: ElkNode): Promise<ElkNode> {
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
			return Promise.resolve({ id: graph.id, children, width: 200, height: y });
		},
	};
	return () => Promise.resolve(elk);
}
