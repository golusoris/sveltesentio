import { describe, it, expect, afterEach } from 'vitest';
import { ProblemError } from '@sveltesentio/core';
import type { ELK, ElkNode } from 'elkjs/lib/elk-api.js';
import type { ElkFactory, ElkLayoutOptions, SizedNode } from '../src/layout.js';
import { createElkLayout } from '../src/layout.js';
import {
	createLayoutWorker,
	layoutWorkerHandler,
	LAYOUT_WORKER_ERROR_TYPE,
	type LayoutWorkerRequest,
	type LayoutWorkerResponse,
} from '../src/layout-worker.js';

// A deterministic ELK double: stacks children top-to-bottom, no real elkjs.
function fakeElkFactory(): ElkFactory {
	const elk: ELK = {
		async layout(graph: ElkNode): Promise<ElkNode> {
			let y = 0;
			const children = (graph.children ?? []).map((c) => {
				const node: ElkNode = {
					id: c.id,
					x: 0,
					y,
					width: c.width ?? 0,
					height: c.height ?? 0,
				};
				y += (c.height ?? 0) + 80;
				return node;
			});
			return { id: graph.id, children, width: 200, height: y };
		},
		async knownLayoutAlgorithms() {
			return [];
		},
		async knownLayoutOptions() {
			return [];
		},
		async knownLayoutCategories() {
			return [];
		},
		terminateWorker(): void {},
	};
	return async () => elk;
}

function throwingElkFactory(message: string): ElkFactory {
	return async () => ({
		async layout(): Promise<ElkNode> {
			throw new Error(message);
		},
		async knownLayoutAlgorithms() {
			return [];
		},
		async knownLayoutOptions() {
			return [];
		},
		async knownLayoutCategories() {
			return [];
		},
		terminateWorker(): void {},
	});
}

type Listener = (event: Event) => void;

/**
 * A fake `Worker` that wires the main side's `postMessage` straight into
 * `layoutWorkerHandler` (the worker-side code), then routes the handler's reply
 * back as a `message` event — a full postMessage round-trip without a real
 * worker thread. `elkFactory` is injected so no elkjs bundle loads at test time.
 */
class FakeWorker {
	terminated = false;
	postCount = 0;
	private readonly messageListeners = new Set<Listener>();
	private readonly errorListeners = new Set<Listener>();
	private readonly handler: (event: MessageEvent<LayoutWorkerRequest>) => Promise<void>;

	constructor(elkFactory: ElkFactory) {
		this.handler = layoutWorkerHandler((response: LayoutWorkerResponse) => {
			// The handler posts its reply back to the main thread.
			this.emit('message', { data: response } as MessageEvent<LayoutWorkerResponse>);
		}, elkFactory);
	}

	postMessage(request: LayoutWorkerRequest): void {
		this.postCount += 1;
		if (this.terminated) throw new Error('posted to a terminated worker');
		void this.handler({ data: request } as MessageEvent<LayoutWorkerRequest>);
	}

	addEventListener(type: 'message' | 'error', listener: Listener): void {
		(type === 'message' ? this.messageListeners : this.errorListeners).add(listener);
	}

	removeEventListener(type: 'message' | 'error', listener: Listener): void {
		(type === 'message' ? this.messageListeners : this.errorListeners).delete(listener);
	}

	terminate(): void {
		this.terminated = true;
	}

	listenerCount(type: 'message' | 'error'): number {
		return (type === 'message' ? this.messageListeners : this.errorListeners).size;
	}

	private emit(type: 'message' | 'error', event: Event): void {
		const set = type === 'message' ? this.messageListeners : this.errorListeners;
		for (const listener of set) listener(event);
	}

	/** Pushes an `error` event to exercise the worker `onerror` path. */
	crash(message: string): void {
		this.emit('error', { message } as ErrorEvent);
	}
}

const NODES: readonly SizedNode[] = [
	{ id: 'a', width: 100, height: 40 },
	{ id: 'b', width: 100, height: 40 },
];
const EDGES = [{ source: 'a', target: 'b' }] as const;

// Some tests stub a global `Worker`; restore it afterwards.
const savedWorker = (globalThis as { Worker?: unknown }).Worker;
afterEach(() => {
	if (savedWorker === undefined) delete (globalThis as { Worker?: unknown }).Worker;
	else (globalThis as { Worker?: unknown }).Worker = savedWorker;
});

function stubWorkerGlobal(): void {
	(globalThis as { Worker?: unknown }).Worker = FakeWorker;
}

describe('createLayoutWorker — worker path', () => {
	it('lays out via a postMessage round-trip and reports usingWorker', async () => {
		stubWorkerGlobal();
		const fake = new FakeWorker(fakeElkFactory());
		const handle = createLayoutWorker({ workerFactory: () => fake as unknown as Worker });

		expect(handle.usingWorker).toBe(true);
		const result = await handle.layout(NODES, EDGES);

		expect(fake.postCount).toBe(1);
		expect(result.nodes).toHaveLength(2);
		expect(result.nodes[0]).toMatchObject({ id: 'a', x: 0, y: 0 });
		expect(result.nodes[1]).toMatchObject({ id: 'b', y: 120 });
		expect(result.edges).toEqual(EDGES);
		expect(result.width).toBe(200);
		handle.terminate();
	});

	it('forwards layoutOptions into the worker request', async () => {
		stubWorkerGlobal();
		let captured: LayoutWorkerRequest | undefined;
		const fake = new FakeWorker(fakeElkFactory());
		const realPost = fake.postMessage.bind(fake);
		fake.postMessage = (req: LayoutWorkerRequest): void => {
			captured = req;
			realPost(req);
		};
		const options: ElkLayoutOptions = { algorithm: 'mrtree', direction: 'RIGHT' };
		const handle = createLayoutWorker({
			layoutOptions: options,
			workerFactory: () => fake as unknown as Worker,
		});
		await handle.layout(NODES, EDGES);
		expect(captured?.options).toEqual(options);
	});

	it('correlates concurrent layouts by request id and cleans up listeners', async () => {
		stubWorkerGlobal();
		const fake = new FakeWorker(fakeElkFactory());
		const handle = createLayoutWorker({ workerFactory: () => fake as unknown as Worker });

		const [r1, r2] = await Promise.all([
			handle.layout(NODES, EDGES),
			handle.layout([{ id: 'solo', width: 10, height: 10 }], []),
		]);
		expect(r1.nodes.map((n) => n.id)).toEqual(['a', 'b']);
		expect(r2.nodes.map((n) => n.id)).toEqual(['solo']);
		// Every settled request must have removed its message + error listeners.
		expect(fake.listenerCount('message')).toBe(0);
		expect(fake.listenerCount('error')).toBe(0);
	});

	it('rejects with a ProblemError when the worker reports a failure', async () => {
		stubWorkerGlobal();
		const fake = new FakeWorker(throwingElkFactory('elk exploded'));
		const handle = createLayoutWorker({ workerFactory: () => fake as unknown as Worker });
		await expect(handle.layout(NODES, EDGES)).rejects.toBeInstanceOf(ProblemError);
		await expect(handle.layout(NODES, EDGES)).rejects.toMatchObject({
			type: LAYOUT_WORKER_ERROR_TYPE,
			detail: 'elk exploded',
			status: 500,
		});
	});

	it('rejects with a ProblemError on a worker error event', async () => {
		stubWorkerGlobal();
		// A factory whose layout never resolves, so only the error event settles it.
		const stalled: ElkFactory = () => new Promise<ELK>(() => {});
		const fake = new FakeWorker(stalled);
		const handle = createLayoutWorker({ workerFactory: () => fake as unknown as Worker });
		const pending = handle.layout(NODES, EDGES);
		fake.crash('worker boom');
		await expect(pending).rejects.toMatchObject({
			type: LAYOUT_WORKER_ERROR_TYPE,
			detail: 'worker boom',
		});
	});

	it('terminate() stops the worker and is idempotent', async () => {
		stubWorkerGlobal();
		const fake = new FakeWorker(fakeElkFactory());
		const handle = createLayoutWorker({ workerFactory: () => fake as unknown as Worker });
		handle.terminate();
		expect(fake.terminated).toBe(true);
		handle.terminate(); // second call is a no-op, must not throw
		await expect(handle.layout(NODES, EDGES)).rejects.toMatchObject({
			type: LAYOUT_WORKER_ERROR_TYPE,
			detail: 'Layout worker has been terminated',
		});
	});
});

describe('createLayoutWorker — no-worker fallback', () => {
	it('runs on the main thread when no workerFactory is given', async () => {
		const handle = createLayoutWorker({
			fallbackFactory: (opts) => createElkLayout(opts, fakeElkFactory()),
		});
		expect(handle.usingWorker).toBe(false);
		const result = await handle.layout(NODES, EDGES);
		expect(result.nodes[1]).toMatchObject({ id: 'b', y: 120 });
		expect(result.width).toBe(200);
		handle.terminate(); // no-op fallback terminate
	});

	it('falls back to the main thread when Worker is undefined (SSR)', async () => {
		// Ensure no global Worker — the SSR condition.
		delete (globalThis as { Worker?: unknown }).Worker;
		let factoryCalled = false;
		const handle = createLayoutWorker({
			workerFactory: () => {
				factoryCalled = true;
				return new FakeWorker(fakeElkFactory()) as unknown as Worker;
			},
			fallbackFactory: (opts) => createElkLayout(opts, fakeElkFactory()),
		});
		expect(handle.usingWorker).toBe(false);
		expect(factoryCalled).toBe(false);
		const result = await handle.layout(NODES, EDGES);
		expect(result.nodes).toHaveLength(2);
	});

	it('defaults options to {} and works with an injected fallback', async () => {
		const handle = createLayoutWorker({
			fallbackFactory: () => createElkLayout({}, fakeElkFactory()),
		});
		const result = await handle.layout([{ id: 'x', width: 20, height: 20 }], []);
		expect(result.nodes[0]).toMatchObject({ id: 'x', x: 0, y: 0 });
	});
});

describe('layoutWorkerHandler', () => {
	it('replies with a success envelope carrying the layout result', async () => {
		const replies: LayoutWorkerResponse[] = [];
		const handle = layoutWorkerHandler((r) => replies.push(r), fakeElkFactory());
		await handle({
			data: { id: 7, options: {}, nodes: NODES, edges: EDGES },
		} as MessageEvent<LayoutWorkerRequest>);
		expect(replies).toHaveLength(1);
		const [reply] = replies;
		expect(reply).toMatchObject({ id: 7, ok: true });
		if (reply?.ok) expect(reply.result.nodes).toHaveLength(2);
	});

	it('replies with a failure envelope when layout throws', async () => {
		const replies: LayoutWorkerResponse[] = [];
		const handle = layoutWorkerHandler((r) => replies.push(r), throwingElkFactory('nope'));
		await handle({
			data: { id: 3, options: {}, nodes: NODES, edges: EDGES },
		} as MessageEvent<LayoutWorkerRequest>);
		expect(replies[0]).toEqual({ id: 3, ok: false, message: 'nope' });
	});

	it('ignores messages without a numeric id', async () => {
		const replies: LayoutWorkerResponse[] = [];
		const handle = layoutWorkerHandler((r) => replies.push(r), fakeElkFactory());
		await handle({ data: undefined } as unknown as MessageEvent<LayoutWorkerRequest>);
		await handle({
			data: { id: 'x' },
		} as unknown as MessageEvent<LayoutWorkerRequest>);
		expect(replies).toHaveLength(0);
	});

	it('stringifies non-Error throwables in the failure message', async () => {
		const replies: LayoutWorkerResponse[] = [];
		const stringThrower: ElkFactory = async () => ({
			async layout(): Promise<ElkNode> {
				throw 'raw string failure';
			},
			async knownLayoutAlgorithms() {
				return [];
			},
			async knownLayoutOptions() {
				return [];
			},
			async knownLayoutCategories() {
				return [];
			},
			terminateWorker(): void {},
		});
		const handle = layoutWorkerHandler((r) => replies.push(r), stringThrower);
		await handle({
			data: { id: 1, options: {}, nodes: [], edges: [] },
		} as MessageEvent<LayoutWorkerRequest>);
		expect(replies[0]).toMatchObject({ ok: false, message: 'raw string failure' });
	});
});
