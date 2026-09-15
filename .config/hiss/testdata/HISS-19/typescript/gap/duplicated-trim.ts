// The same bounded-history trim written twice, which is what HISS-19 forbids.
// This is the real shape found during the 2026-09-15 adoption: useSSE and
// useConnectStream each carried it inline and identically, and it was found by
// reading rather than by a tool. `praetorctl dedupe scan` reports 0 files here
// because it reads the same extensions the HISS scanner does.
export function appendCapped(current: readonly number[], batch: readonly number[], limit: number): number[] {
	const next = current.concat(batch);
	return next.length > limit ? next.slice(next.length - limit) : next;
}

export function appendBoundedCopy(current: readonly number[], batch: readonly number[], limit: number): number[] {
	const next = current.concat(batch);
	return next.length > limit ? next.slice(next.length - limit) : next;
}
