import type { ELK, ElkNode, LayoutOptions } from 'elkjs/lib/elk-api.js';
import type { DagEdgeLike, DagNodeLike } from './dag.js';

export type ElkDirection = 'DOWN' | 'UP' | 'RIGHT' | 'LEFT';
export type ElkAlgorithm = 'layered' | 'force' | 'stress' | 'mrtree';

export interface ElkLayoutOptions {
	readonly algorithm?: ElkAlgorithm;
	readonly direction?: ElkDirection;
	readonly nodeSpacing?: number;
	readonly layerSpacing?: number;
	readonly layoutOptions?: LayoutOptions;
}

export interface SizedNode extends DagNodeLike {
	readonly width: number;
	readonly height: number;
}

export interface PositionedNode extends SizedNode {
	readonly x: number;
	readonly y: number;
}

export interface ElkLayoutResult<E extends DagEdgeLike> {
	readonly nodes: readonly PositionedNode[];
	readonly edges: readonly E[];
	readonly width: number;
	readonly height: number;
}

export type ElkFactory = () => Promise<ELK>;

const defaultElkFactory: ElkFactory = async () => {
	const mod = await import('elkjs/lib/elk.bundled.js');
	const Ctor = (mod as unknown as { default: new () => ELK }).default;
	return new Ctor();
};

export function createElkLayout(
	options: ElkLayoutOptions = {},
	factory: ElkFactory = defaultElkFactory,
) {
	const {
		algorithm = 'layered',
		direction = 'DOWN',
		nodeSpacing = 80,
		layerSpacing = 80,
		layoutOptions,
	} = options;
	const mergedLayoutOptions: LayoutOptions = {
		'elk.algorithm': algorithm,
		'elk.direction': direction,
		'elk.spacing.nodeNode': String(nodeSpacing),
		'elk.layered.spacing.nodeNodeBetweenLayers': String(layerSpacing),
		...layoutOptions,
	};

	return async function layout<
		N extends SizedNode,
		E extends DagEdgeLike,
	>(nodes: readonly N[], edges: readonly E[]): Promise<ElkLayoutResult<E>> {
		const elk = await factory();
		const graph: ElkNode = {
			id: 'root',
			layoutOptions: mergedLayoutOptions,
			children: nodes.map((n) => ({
				id: n.id,
				width: n.width,
				height: n.height,
			})),
			edges: edges.map((e, index) => ({
				id: `e${index}`,
				sources: [e.source],
				targets: [e.target],
			})),
		};

		const result = await elk.layout(graph);
		const byId = new Map<string, PositionedNode>();
		for (const child of result.children ?? []) {
			byId.set(child.id, {
				id: child.id,
				x: child.x ?? 0,
				y: child.y ?? 0,
				width: child.width ?? 0,
				height: child.height ?? 0,
			});
		}
		const positioned: PositionedNode[] = nodes.map((n) => {
			const pos = byId.get(n.id);
			return pos ?? { id: n.id, x: 0, y: 0, width: n.width, height: n.height };
		});
		return {
			nodes: positioned,
			edges,
			width: result.width ?? 0,
			height: result.height ?? 0,
		};
	};
}
