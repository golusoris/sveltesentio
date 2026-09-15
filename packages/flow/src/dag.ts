export interface DagNodeLike {
	readonly id: string;
}

export interface DagEdgeLike {
	readonly source: string;
	readonly target: string;
}

export interface Adjacency {
	readonly outgoing: ReadonlyMap<string, readonly string[]>;
	readonly incoming: ReadonlyMap<string, readonly string[]>;
}

export function buildAdjacency(
	nodes: readonly DagNodeLike[],
	edges: readonly DagEdgeLike[],
): Adjacency {
	const outgoing = new Map<string, string[]>();
	const incoming = new Map<string, string[]>();
	for (const node of nodes) {
		outgoing.set(node.id, []);
		incoming.set(node.id, []);
	}
	for (const edge of edges) {
		const out = outgoing.get(edge.source);
		const inc = incoming.get(edge.target);
		if (!out || !inc) continue;
		out.push(edge.target);
		inc.push(edge.source);
	}
	return { outgoing, incoming };
}

export class CycleError extends Error {
	readonly cycle: readonly string[];
	constructor(cycle: readonly string[]) {
		super(`graph contains a cycle: ${cycle.join(' -> ')}`);
		this.name = 'CycleError';
		this.cycle = cycle;
	}
}

/**
 * Seeds Kahn's algorithm: the indegree of every node, and the ids that start ready.
 *
 * The ready queue is sorted so a graph with several roots yields one deterministic
 * order rather than whatever order the node list happened to arrive in.
 */
function initialIndegrees(
	nodes: readonly DagNodeLike[],
	incoming: ReadonlyMap<string, readonly string[]>,
): { indegree: Map<string, number>; queue: string[] } {
	const indegree = new Map<string, number>();
	for (const node of nodes) {
		indegree.set(node.id, incoming.get(node.id)?.length ?? 0);
	}
	const queue: string[] = [];
	for (const [id, deg] of indegree) if (deg === 0) queue.push(id);
	queue.sort();
	return { indegree, queue };
}

export function topologicalSort(
	nodes: readonly DagNodeLike[],
	edges: readonly DagEdgeLike[],
): string[] {
	const { outgoing, incoming } = buildAdjacency(nodes, edges);
	const { indegree, queue } = initialIndegrees(nodes, incoming);

	const order: string[] = [];
	for (;;) {
		const id = queue.shift();
		// Ends the loop on an empty queue without asserting what `shift` returned.
		if (id === undefined) break;
		order.push(id);
		for (const next of outgoing.get(id) ?? []) {
			const deg = (indegree.get(next) ?? 0) - 1;
			indegree.set(next, deg);
			if (deg === 0) {
				queue.push(next);
				queue.sort();
			}
		}
	}
	if (order.length !== nodes.length) {
		const cycle = findFirstCycle(nodes, edges);
		throw new CycleError(cycle ?? []);
	}
	return order;
}

export function findCycles(
	nodes: readonly DagNodeLike[],
	edges: readonly DagEdgeLike[],
): string[][] {
	const { outgoing } = buildAdjacency(nodes, edges);
	const cycles: string[][] = [];
	const visited = new Set<string>();
	const onStack = new Set<string>();
	const stack: string[] = [];

	const visit = (id: string): void => {
		if (onStack.has(id)) {
			const index = stack.indexOf(id);
			if (index >= 0) cycles.push([...stack.slice(index), id]);
			return;
		}
		if (visited.has(id)) return;
		visited.add(id);
		onStack.add(id);
		stack.push(id);
		for (const next of outgoing.get(id) ?? []) visit(next);
		stack.pop();
		onStack.delete(id);
	};

	for (const node of nodes) visit(node.id);
	return cycles;
}

export function reachableFrom(
	nodes: readonly DagNodeLike[],
	edges: readonly DagEdgeLike[],
	startId: string,
): Set<string> {
	const { outgoing } = buildAdjacency(nodes, edges);
	const reached = new Set<string>();
	const queue: string[] = [startId];
	for (;;) {
		const id = queue.shift();
		// Ends the loop on an empty queue without asserting what `shift` returned.
		if (id === undefined) break;
		if (reached.has(id)) continue;
		reached.add(id);
		for (const next of outgoing.get(id) ?? []) queue.push(next);
	}
	reached.delete(startId);
	return reached;
}

export function hasCycle(
	nodes: readonly DagNodeLike[],
	edges: readonly DagEdgeLike[],
): boolean {
	return findCycles(nodes, edges).length > 0;
}

function findFirstCycle(
	nodes: readonly DagNodeLike[],
	edges: readonly DagEdgeLike[],
): string[] | undefined {
	const cycles = findCycles(nodes, edges);
	return cycles[0];
}
