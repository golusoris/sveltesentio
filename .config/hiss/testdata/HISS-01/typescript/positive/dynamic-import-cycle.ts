// A cycle formed through a dynamic import. check-import-cycles.mjs now reads
// `import()` with a literal specifier, so this edge is an edge like any other:
// the fact that it resolves at runtime rather than at parse time does not make
// the graph acyclic. Verified by planting this shape under packages/core/src and
// watching the checker exit 1 with the path.
export async function loadPeer(): Promise<unknown> {
	const peer = await import('./self-recursive.js');
	return peer;
}
