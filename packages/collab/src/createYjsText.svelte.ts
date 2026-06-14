import type * as Y from 'yjs';
import {
	snapshotYjsText,
	observeYjsText,
	insertYjsText,
	deleteYjsText,
	appendYjsText,
} from './yjs-text.js';

export interface YjsTextStore {
	readonly value: string;
	readonly length: number;
	insert(index: number, value: string): void;
	delete(index: number, length: number): void;
	append(value: string): void;
	toString(): string;
}

export function createYjsText(yText: Y.Text): YjsTextStore {
	let snapshot = $state<string>(snapshotYjsText(yText));

	$effect(() => {
		const unsubscribe = observeYjsText(yText, () => {
			snapshot = snapshotYjsText(yText);
		});
		return unsubscribe;
	});

	return {
		get value(): string {
			return snapshot;
		},
		get length(): number {
			return snapshot.length;
		},
		insert(index: number, value: string): void {
			insertYjsText(yText, index, value);
		},
		delete(index: number, length: number): void {
			deleteYjsText(yText, index, length);
		},
		append(value: string): void {
			appendYjsText(yText, value);
		},
		toString(): string {
			return snapshot;
		},
	};
}
