import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

/**
 * Non-reactive `$state` / `$effect` shim — see createYjsStore.test.ts for the
 * rationale. The text store's getters close over `let snapshot = $state(...)`,
 * so reassignment inside the Yjs `observe()` callback is what the getters
 * surface; that snapshot-sync is the behaviour under test (ADR-0039).
 */
const teardowns: Array<() => void> = [];
const g = globalThis as unknown as {
	$state?: unknown;
	$effect?: unknown;
};

beforeEach(() => {
	g.$state = <T>(initial: T): T => initial;
	const effect = (fn: () => void | (() => void)): void => {
		const cleanup = fn();
		if (typeof cleanup === 'function') teardowns.push(cleanup);
	};
	g.$effect = effect;
});

afterEach(() => {
	teardowns.length = 0;
	delete g.$state;
	delete g.$effect;
});

function newText(): { doc: Y.Doc; yText: Y.Text } {
	const doc = new Y.Doc();
	const yText = doc.getText('body');
	return { doc, yText };
}

describe('createYjsText (text rune)', () => {
	it('snapshot reflects the Y.Text at construction time', async () => {
		const { createYjsText } = await import('../src/createYjsText.svelte.js');
		const { yText } = newText();
		yText.insert(0, 'hello');
		const store = createYjsText(yText);
		expect(store.value).toBe('hello');
		expect(store.length).toBe(5);
	});

	it('snapshot re-syncs when the Y.Text mutates after subscription', async () => {
		const { createYjsText } = await import('../src/createYjsText.svelte.js');
		const { yText } = newText();
		const store = createYjsText(yText);
		expect(store.value).toBe('');

		yText.insert(0, 'hi');
		expect(store.value).toBe('hi');
		expect(store.length).toBe(2);

		yText.delete(0, 1);
		expect(store.value).toBe('i');
	});

	it('mutation methods route through the Y.Text', async () => {
		const { createYjsText } = await import('../src/createYjsText.svelte.js');
		const { yText } = newText();
		const store = createYjsText(yText);

		store.insert(0, 'hello');
		store.append(' world');
		expect(yText.toString()).toBe('hello world');
		expect(store.value).toBe('hello world');

		store.delete(5, 6);
		expect(yText.toString()).toBe('hello');
		expect(store.value).toBe('hello');
	});

	it('toString returns the synced snapshot', async () => {
		const { createYjsText } = await import('../src/createYjsText.svelte.js');
		const { yText } = newText();
		const store = createYjsText(yText);
		store.append('abc');
		expect(store.toString()).toBe('abc');
		expect(`${store.toString()}!`).toBe('abc!');
	});

	it('$effect cleanup unsubscribes from the Y.Text observer', async () => {
		const { createYjsText } = await import('../src/createYjsText.svelte.js');
		const { yText } = newText();
		const store = createYjsText(yText);

		yText.insert(0, 'a');
		expect(store.value).toBe('a');

		expect(teardowns).toHaveLength(1);
		teardowns[0]!();

		yText.insert(1, 'b');
		expect(store.value).toBe('a');
	});
});
