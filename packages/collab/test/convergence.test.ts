import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

/**
 * Two-doc convergence harness for the `createYjs*` rune stores.
 *
 * A real `y-websocket` provider relays a doc's binary update blobs to peers,
 * which `Y.applyUpdate` back into their own doc. `FakeTransport` reproduces
 * exactly that mechanism in-memory — no socket, no network — so we can assert
 * that edits made *through the rune stores* on one doc converge onto a peer
 * doc's stores. The `'fake-transport'` origin tag breaks the echo loop:
 * updates the transport itself applies are not re-broadcast.
 *
 * The `.svelte.ts` rune modules need `$state` / `$effect` at runtime. As in
 * `createYjsStore.test.ts`, we install a minimal non-reactive shim: `$state(v)`
 * returns `v`, `$effect(fn)` runs the body immediately and records teardown.
 * The store getters close over the `let snapshot = $state(...)` binding, so the
 * reassignment inside each Yjs `observe()` callback is visible through the
 * getters — that snapshot-sync is the behaviour under test, not framework
 * reactivity.
 */
const ORIGIN = 'fake-transport';

class FakeTransport {
	private readonly docs: Y.Doc[] = [];
	private readonly handlers = new Map<Y.Doc, (u: Uint8Array, o: unknown) => void>();

	/** Joins a doc to the mesh and back-fills it with current shared state. */
	connect(doc: Y.Doc): void {
		for (const peer of this.docs) {
			Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer), ORIGIN);
			Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc), ORIGIN);
		}
		const handler = (update: Uint8Array, origin: unknown): void => {
			if (origin === ORIGIN) return; // don't echo transport-applied updates
			for (const peer of this.docs) {
				if (peer !== doc) Y.applyUpdate(peer, update, ORIGIN);
			}
		};
		doc.on('update', handler);
		this.handlers.set(doc, handler);
		this.docs.push(doc);
	}

	destroy(): void {
		for (const [doc, handler] of this.handlers) doc.off('update', handler);
		this.handlers.clear();
		this.docs.length = 0;
	}
}

const teardowns: Array<() => void> = [];
const g = globalThis as unknown as { $state?: unknown; $effect?: unknown };

beforeEach(() => {
	g.$state = <T>(initial: T): T => initial;
	g.$effect = (fn: () => void | (() => void)): void => {
		const cleanup = fn();
		if (typeof cleanup === 'function') teardowns.push(cleanup);
	};
});

afterEach(() => {
	for (const t of teardowns) t();
	teardowns.length = 0;
	delete g.$state;
	delete g.$effect;
});

describe('convergence — createYjsStore (Y.Array) over a fake transport', () => {
	it('one-way edits propagate to the peer store', async () => {
		const { createYjsStore } = await import('../src/createYjsStore.svelte.js');
		const transport = new FakeTransport();
		const docA = new Y.Doc();
		const docB = new Y.Doc();
		transport.connect(docA);
		transport.connect(docB);

		const a = createYjsStore(docA.getArray<string>('items'));
		const b = createYjsStore(docB.getArray<string>('items'));

		a.push('x', 'y');
		expect(b.items).toEqual(['x', 'y']);
		expect(a.items).toEqual(b.items);
		transport.destroy();
	});

	it('concurrent inserts from both peers converge to one state', async () => {
		const { createYjsStore } = await import('../src/createYjsStore.svelte.js');
		const transport = new FakeTransport();
		const docA = new Y.Doc();
		const docB = new Y.Doc();
		transport.connect(docA);
		transport.connect(docB);

		const a = createYjsStore(docA.getArray<string>('items'));
		const b = createYjsStore(docB.getArray<string>('items'));

		a.push('a1');
		b.push('b1');

		// Deterministic CRDT merge — both peers see the same total order.
		expect(a.items).toEqual(b.items);
		expect([...a.items].sort()).toEqual(['a1', 'b1']);
		transport.destroy();
	});

	it('a late-joining peer back-fills existing state', async () => {
		const { createYjsStore } = await import('../src/createYjsStore.svelte.js');
		const transport = new FakeTransport();
		const docA = new Y.Doc();
		transport.connect(docA);
		const a = createYjsStore(docA.getArray<number>('items'));
		a.push(1, 2, 3);

		const docB = new Y.Doc();
		transport.connect(docB); // joins after edits already happened
		const b = createYjsStore(docB.getArray<number>('items'));
		expect(b.items).toEqual([1, 2, 3]);

		a.push(4);
		expect(b.items).toEqual([1, 2, 3, 4]);
		transport.destroy();
	});

	it('a delete on one peer converges on the other', async () => {
		const { createYjsStore } = await import('../src/createYjsStore.svelte.js');
		const transport = new FakeTransport();
		const docA = new Y.Doc();
		const docB = new Y.Doc();
		transport.connect(docA);
		transport.connect(docB);

		const a = createYjsStore(docA.getArray<string>('items'));
		const b = createYjsStore(docB.getArray<string>('items'));
		a.push('keep', 'drop', 'keep2');
		expect(b.items).toEqual(['keep', 'drop', 'keep2']);

		b.delete(1, 1);
		expect(a.items).toEqual(['keep', 'keep2']);
		expect(a.items).toEqual(b.items);
		transport.destroy();
	});
});

describe('convergence — createYjsMap (Y.Map) over a fake transport', () => {
	it('sets propagate and last-writer-wins resolves a key collision', async () => {
		const { createYjsMap } = await import('../src/createYjsMap.svelte.js');
		const transport = new FakeTransport();
		const docA = new Y.Doc();
		const docB = new Y.Doc();
		transport.connect(docA);
		transport.connect(docB);

		const a = createYjsMap<string>(docA.getMap<string>('meta'));
		const b = createYjsMap<string>(docB.getMap<string>('meta'));

		a.set('title', 'from-a');
		expect(b.get('title')).toBe('from-a');

		// Sequenced writes to the same key converge to the later value on both.
		a.set('title', 'final');
		expect(a.get('title')).toBe('final');
		expect(b.get('title')).toBe('final');
		expect(a.entries).toEqual(b.entries);
		transport.destroy();
	});

	it('a delete converges across peers', async () => {
		const { createYjsMap } = await import('../src/createYjsMap.svelte.js');
		const transport = new FakeTransport();
		const docA = new Y.Doc();
		const docB = new Y.Doc();
		transport.connect(docA);
		transport.connect(docB);

		const a = createYjsMap<number>(docA.getMap<number>('meta'));
		const b = createYjsMap<number>(docB.getMap<number>('meta'));
		a.set('count', 1);
		expect(b.get('count')).toBe(1);

		b.delete('count');
		expect(a.has('count')).toBe(false);
		expect(a.entries).toEqual(b.entries);
		transport.destroy();
	});
});

describe('convergence — createYjsText (Y.Text) over a fake transport', () => {
	it('concurrent inserts at the same index merge without loss', async () => {
		const { createYjsText } = await import('../src/createYjsText.svelte.js');
		const transport = new FakeTransport();
		const docA = new Y.Doc();
		const docB = new Y.Doc();
		transport.connect(docA);
		transport.connect(docB);

		const a = createYjsText(docA.getText('body'));
		const b = createYjsText(docB.getText('body'));

		a.append('hello ');
		expect(b.value).toBe('hello ');

		// Concurrent edits to the same starting index: CRDT keeps both runs.
		a.insert(6, 'world');
		b.insert(0, 'say: ');

		expect(a.value).toBe(b.value);
		expect(a.value).toContain('world');
		expect(a.value).toContain('say: ');
		transport.destroy();
	});
});
