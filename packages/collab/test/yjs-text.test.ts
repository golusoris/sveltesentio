import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
	snapshotYjsText,
	observeYjsText,
	insertYjsText,
	deleteYjsText,
	appendYjsText,
} from '../src/yjs-text.js';

function newText(): { doc: Y.Doc; yText: Y.Text } {
	const doc = new Y.Doc();
	const yText = doc.getText('body');
	return { doc, yText };
}

describe('yjs-text', () => {
	it('insertYjsText / appendYjsText / deleteYjsText mutate the text', () => {
		const { yText } = newText();
		insertYjsText(yText, 0, 'hello');
		appendYjsText(yText, ' world');
		expect(snapshotYjsText(yText)).toBe('hello world');
		deleteYjsText(yText, 5, 6);
		expect(snapshotYjsText(yText)).toBe('hello');
	});

	it('empty inserts and zero deletes are no-ops', () => {
		const { yText } = newText();
		insertYjsText(yText, 0, '');
		appendYjsText(yText, '');
		deleteYjsText(yText, 0, 0);
		expect(snapshotYjsText(yText)).toBe('');
	});

	it('observeYjsText fires on change; unsub stops it', () => {
		const { yText } = newText();
		const snapshots: string[] = [];
		const unsub = observeYjsText(yText, () => {
			snapshots.push(yText.toString());
		});
		insertYjsText(yText, 0, 'a');
		appendYjsText(yText, 'b');
		unsub();
		appendYjsText(yText, 'c');
		expect(snapshots).toEqual(['a', 'ab']);
	});
});
