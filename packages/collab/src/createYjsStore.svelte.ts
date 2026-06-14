import type * as Y from 'yjs';
import {
	snapshotYjsArray,
	observeYjsArray,
	appendToYjsArray,
	insertIntoYjsArray,
	deleteFromYjsArray,
} from './yjs-array.js';

export interface YjsArrayStore<T> {
	readonly items: readonly T[];
	readonly length: number;
	get(index: number): T | undefined;
	push(...values: T[]): void;
	insert(index: number, values: readonly T[]): void;
	delete(index: number, length?: number): void;
	toArray(): T[];
}

export function createYjsStore<T>(yArray: Y.Array<T>): YjsArrayStore<T> {
	let snapshot = $state<T[]>(snapshotYjsArray(yArray));

	$effect(() => {
		const unsubscribe = observeYjsArray(yArray, () => {
			snapshot = snapshotYjsArray(yArray);
		});
		return unsubscribe;
	});

	return {
		get items(): readonly T[] {
			return snapshot;
		},
		get length(): number {
			return snapshot.length;
		},
		get(index: number): T | undefined {
			return snapshot[index];
		},
		push(...values: T[]): void {
			appendToYjsArray(yArray, ...values);
		},
		insert(index: number, values: readonly T[]): void {
			insertIntoYjsArray(yArray, index, values);
		},
		delete(index: number, length = 1): void {
			deleteFromYjsArray(yArray, index, length);
		},
		toArray(): T[] {
			return [...snapshot];
		},
	};
}
