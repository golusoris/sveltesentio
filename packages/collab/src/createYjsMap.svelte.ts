import type * as Y from 'yjs';
import {
	snapshotYjsMap,
	observeYjsMap,
	setYjsMap,
	deleteYjsMap,
	clearYjsMap,
} from './yjs-map.js';

export interface YjsMapStore<V> {
	readonly entries: Readonly<Record<string, V>>;
	readonly size: number;
	get(key: string): V | undefined;
	has(key: string): boolean;
	keys(): string[];
	values(): V[];
	set(key: string, value: V): void;
	delete(key: string): void;
	clear(): void;
}

export function createYjsMap<V>(yMap: Y.Map<V>): YjsMapStore<V> {
	let snapshot = $state<Record<string, V>>(snapshotYjsMap(yMap));

	$effect(() => {
		const unsubscribe = observeYjsMap(yMap, () => {
			snapshot = snapshotYjsMap(yMap);
		});
		return unsubscribe;
	});

	return {
		get entries(): Readonly<Record<string, V>> {
			return snapshot;
		},
		get size(): number {
			return Object.keys(snapshot).length;
		},
		get(key: string): V | undefined {
			return snapshot[key];
		},
		has(key: string): boolean {
			return Object.prototype.hasOwnProperty.call(snapshot, key);
		},
		keys(): string[] {
			return Object.keys(snapshot);
		},
		values(): V[] {
			return Object.values(snapshot);
		},
		set(key: string, value: V): void {
			setYjsMap(yMap, key, value);
		},
		delete(key: string): void {
			deleteYjsMap(yMap, key);
		},
		clear(): void {
			clearYjsMap(yMap);
		},
	};
}
