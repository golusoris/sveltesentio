import type * as Y from 'yjs';

export type YjsMapObserver<V> = (
	event: Y.YMapEvent<V>,
	transaction: Y.Transaction,
) => void;

export function snapshotYjsMap<V>(yMap: Y.Map<V>): Record<string, V> {
	const out: Record<string, V> = {};
	for (const [key, value] of yMap.entries()) out[key] = value;
	return out;
}

export function snapshotYjsMapEntries<V>(yMap: Y.Map<V>): [string, V][] {
	return Array.from(yMap.entries());
}

export function observeYjsMap<V>(
	yMap: Y.Map<V>,
	listener: YjsMapObserver<V>,
): () => void {
	yMap.observe(listener);
	return () => yMap.unobserve(listener);
}

export function setYjsMap<V>(yMap: Y.Map<V>, key: string, value: V): void {
	yMap.set(key, value);
}

export function deleteYjsMap<V>(yMap: Y.Map<V>, key: string): void {
	yMap.delete(key);
}

export function clearYjsMap<V>(yMap: Y.Map<V>): void {
	yMap.clear();
}
