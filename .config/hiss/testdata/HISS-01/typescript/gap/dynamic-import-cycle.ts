// A cycle formed through a dynamic import. check-import-cycles.mjs reads static
// `import ... from` specifiers only, so this edge is invisible to it and the
// cycle goes unreported — one of the two gaps the HISS-01 claim names.
export async function loadPeer(): Promise<unknown> {
	const peer = await import('./self-recursive.js');
	return peer;
}
