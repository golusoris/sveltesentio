import { describe, it, expect } from 'vitest';
import {
	buildAdjacency,
	topologicalSort,
	findCycles,
	reachableFrom,
	hasCycle,
	CycleError,
} from '../src/dag.js';

const nodes = (...ids: string[]): { id: string }[] => ids.map((id) => ({ id }));
const edge = (source: string, target: string): { source: string; target: string } => ({
	source,
	target,
});

describe('buildAdjacency', () => {
	it('records incoming + outgoing per node, including isolated nodes', () => {
		const adj = buildAdjacency(nodes('a', 'b', 'c', 'd'), [edge('a', 'b'), edge('b', 'c')]);
		expect([...(adj.outgoing.get('a') ?? [])]).toEqual(['b']);
		expect([...(adj.outgoing.get('b') ?? [])]).toEqual(['c']);
		expect([...(adj.outgoing.get('d') ?? [])]).toEqual([]);
		expect([...(adj.incoming.get('a') ?? [])]).toEqual([]);
		expect([...(adj.incoming.get('c') ?? [])]).toEqual(['b']);
	});

	it('ignores edges whose endpoints are not in the node set', () => {
		const adj = buildAdjacency(nodes('a', 'b'), [edge('a', 'b'), edge('a', 'z'), edge('x', 'b')]);
		expect([...(adj.outgoing.get('a') ?? [])]).toEqual(['b']);
		expect([...(adj.incoming.get('b') ?? [])]).toEqual(['a']);
	});
});

describe('topologicalSort', () => {
	it('orders a simple DAG in dependency order', () => {
		const order = topologicalSort(nodes('c', 'a', 'b'), [edge('a', 'b'), edge('b', 'c')]);
		expect(order).toEqual(['a', 'b', 'c']);
	});

	it('breaks ties deterministically by id sort', () => {
		const order = topologicalSort(nodes('c', 'a', 'b'), []);
		expect(order).toEqual(['a', 'b', 'c']);
	});

	it('throws CycleError on a cyclic graph', () => {
		expect(() => topologicalSort(nodes('a', 'b'), [edge('a', 'b'), edge('b', 'a')])).toThrow(
			CycleError,
		);
	});

	it('handles a disconnected graph', () => {
		const order = topologicalSort(nodes('a', 'b', 'c', 'd'), [edge('a', 'b'), edge('c', 'd')]);
		// Kahn's algorithm with alphabetical tie-break: a precedes b, c precedes d;
		// interleaving is order-deterministic.
		expect(order).toEqual(['a', 'b', 'c', 'd']);
	});
});

describe('findCycles + hasCycle', () => {
	it('returns empty array for a DAG', () => {
		expect(findCycles(nodes('a', 'b', 'c'), [edge('a', 'b'), edge('b', 'c')])).toEqual([]);
		expect(hasCycle(nodes('a', 'b', 'c'), [edge('a', 'b'), edge('b', 'c')])).toBe(false);
	});

	it('detects a 2-node cycle', () => {
		const cycles = findCycles(nodes('a', 'b'), [edge('a', 'b'), edge('b', 'a')]);
		expect(cycles.length).toBeGreaterThan(0);
		expect(hasCycle(nodes('a', 'b'), [edge('a', 'b'), edge('b', 'a')])).toBe(true);
	});

	it('detects a self-loop', () => {
		const cycles = findCycles(nodes('a'), [edge('a', 'a')]);
		expect(cycles.length).toBeGreaterThan(0);
		expect(cycles[0]).toContain('a');
	});

	it('detects a 3-node cycle', () => {
		const cycles = findCycles(
			nodes('a', 'b', 'c'),
			[edge('a', 'b'), edge('b', 'c'), edge('c', 'a')],
		);
		expect(cycles.length).toBeGreaterThan(0);
	});
});

describe('reachableFrom', () => {
	it('returns all transitively reachable nodes, excluding the start', () => {
		const reached = reachableFrom(
			nodes('a', 'b', 'c', 'd', 'e'),
			[edge('a', 'b'), edge('b', 'c'), edge('b', 'd'), edge('e', 'a')],
			'a',
		);
		expect([...reached].sort()).toEqual(['b', 'c', 'd']);
	});

	it('returns empty set for a leaf node', () => {
		const reached = reachableFrom(nodes('a', 'b'), [edge('a', 'b')], 'b');
		expect([...reached]).toEqual([]);
	});

	it('handles cycles without infinite looping', () => {
		const reached = reachableFrom(
			nodes('a', 'b', 'c'),
			[edge('a', 'b'), edge('b', 'c'), edge('c', 'a')],
			'a',
		);
		expect([...reached].sort()).toEqual(['b', 'c']);
	});
});

describe('CycleError', () => {
	it('carries the cycle path in its message + property', () => {
		try {
			topologicalSort(nodes('a', 'b'), [edge('a', 'b'), edge('b', 'a')]);
		} catch (e) {
			expect(e).toBeInstanceOf(CycleError);
			if (e instanceof CycleError) {
				expect(e.cycle.length).toBeGreaterThan(0);
				expect(e.message).toContain('cycle');
			}
		}
	});
});
