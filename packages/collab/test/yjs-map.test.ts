import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
	snapshotYjsMap,
	snapshotYjsMapEntries,
	observeYjsMap,
	setYjsMap,
	deleteYjsMap,
	clearYjsMap,
} from '../src/yjs-map.js';

function newMap<V>(): { doc: Y.Doc; yMap: Y.Map<V> } {
	const doc = new Y.Doc();
	const yMap = doc.getMap<V>('entries');
	return { doc, yMap };
}

describe('yjs-map', () => {
	it('snapshotYjsMap returns a plain record', () => {
		const { yMap } = newMap<number>();
		yMap.set('a', 1);
		yMap.set('b', 2);
		expect(snapshotYjsMap(yMap)).toEqual({ a: 1, b: 2 });
	});

	it('snapshotYjsMapEntries returns entry pairs', () => {
		const { yMap } = newMap<string>();
		yMap.set('x', 'hello');
		expect(snapshotYjsMapEntries(yMap)).toEqual([['x', 'hello']]);
	});

	it('setYjsMap / deleteYjsMap / clearYjsMap mutate the map', () => {
		const { yMap } = newMap<number>();
		setYjsMap(yMap, 'a', 1);
		setYjsMap(yMap, 'b', 2);
		deleteYjsMap(yMap, 'a');
		expect(snapshotYjsMap(yMap)).toEqual({ b: 2 });
		clearYjsMap(yMap);
		expect(snapshotYjsMap(yMap)).toEqual({});
	});

	it('observeYjsMap invokes listener on change; unsub stops it', () => {
		const { yMap } = newMap<number>();
		const calls: string[][] = [];
		const unsub = observeYjsMap(yMap, (event) => {
			calls.push([...event.keysChanged]);
		});
		setYjsMap(yMap, 'a', 1);
		setYjsMap(yMap, 'b', 2);
		unsub();
		setYjsMap(yMap, 'c', 3);
		expect(calls).toEqual([['a'], ['b']]);
	});
});
