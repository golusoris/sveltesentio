import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
	snapshotYjsArray,
	observeYjsArray,
	appendToYjsArray,
	insertIntoYjsArray,
	deleteFromYjsArray,
	transactYjs,
} from '../src/yjs-array.js';

function newArray<T>(): { doc: Y.Doc; yArray: Y.Array<T> } {
	const doc = new Y.Doc();
	const yArray = doc.getArray<T>('items');
	return { doc, yArray };
}

describe('yjs-array', () => {
	it('snapshotYjsArray returns current values as plain array', () => {
		const { yArray } = newArray<number>();
		yArray.push([1, 2, 3]);
		expect(snapshotYjsArray(yArray)).toEqual([1, 2, 3]);
	});

	it('appendToYjsArray pushes values, noop on empty', () => {
		const { yArray } = newArray<string>();
		appendToYjsArray(yArray, 'a', 'b');
		appendToYjsArray(yArray);
		expect(yArray.toArray()).toEqual(['a', 'b']);
	});

	it('insertIntoYjsArray inserts at index, noop on empty', () => {
		const { yArray } = newArray<number>();
		yArray.push([1, 4]);
		insertIntoYjsArray(yArray, 1, [2, 3]);
		insertIntoYjsArray(yArray, 0, []);
		expect(yArray.toArray()).toEqual([1, 2, 3, 4]);
	});

	it('deleteFromYjsArray removes by index+length, noop on zero', () => {
		const { yArray } = newArray<number>();
		yArray.push([1, 2, 3, 4]);
		deleteFromYjsArray(yArray, 1, 2);
		deleteFromYjsArray(yArray, 0, 0);
		expect(yArray.toArray()).toEqual([1, 4]);
	});

	it('observeYjsArray invokes listener on change; unsub stops it', () => {
		const { yArray } = newArray<number>();
		const calls: number[] = [];
		const unsub = observeYjsArray(yArray, () => {
			calls.push(yArray.length);
		});
		appendToYjsArray(yArray, 1);
		appendToYjsArray(yArray, 2);
		unsub();
		appendToYjsArray(yArray, 3);
		expect(calls).toEqual([1, 2]);
	});

	it('transactYjs batches mutations into a single event and returns fn result', () => {
		const { doc, yArray } = newArray<number>();
		const events: number[] = [];
		yArray.observe(() => events.push(yArray.length));
		const result = transactYjs(doc, () => {
			appendToYjsArray(yArray, 1, 2, 3);
			return 'done';
		});
		expect(result).toBe('done');
		expect(events).toEqual([3]);
	});
});
