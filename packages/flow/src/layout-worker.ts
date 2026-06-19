// Runs the elkjs layout (./layout) off the main thread in a Web Worker, with an
// SSR / no-worker fallback to the main-thread `createElkLayout`. The Worker
// factory is injected (not hard-coded `new Worker(new URL(...))`) so this is
// unit-testable in Node against a fake Worker, and so SSR — where `Worker` does
// not exist — transparently degrades to the in-process layout instead of
// throwing. ELK's own bundle (~1.5 MB) loads inside the worker (or lazily on the
// main thread via `createElkLayout`), so a page that never lays out pays nothing.

import { ProblemError } from '@sveltesentio/core';
import type { DagEdgeLike } from './dag.js';
import {
	createElkLayout,
	type ElkFactory,
	type ElkLayoutOptions,
	type ElkLayoutResult,
	type SizedNode,
} from './layout.js';

/** RFC 9457 `type` URN for an error raised while laying out inside the worker. */
export const LAYOUT_WORKER_ERROR_TYPE =
	'https://sveltesentio.dev/problems/flow/layout-worker';

/** The request envelope posted from the main thread into the layout worker. */
export interface LayoutWorkerRequest<E extends DagEdgeLike = DagEdgeLike> {
	/** Correlates a reply to its request so concurrent layouts never cross. */
	readonly id: number;
	readonly options: ElkLayoutOptions;
	readonly nodes: readonly SizedNode[];
	readonly edges: readonly E[];
}

/** A successful reply posted back from the worker. */
export interface LayoutWorkerSuccess<E extends DagEdgeLike = DagEdgeLike> {
	readonly id: number;
	readonly ok: true;
	readonly result: ElkLayoutResult<E>;
}

/** A failed reply — `message` is surfaced as a {@link ProblemError} `detail`. */
export interface LayoutWorkerFailure {
	readonly id: number;
	readonly ok: false;
	readonly message: string;
}

export type LayoutWorkerResponse<E extends DagEdgeLike = DagEdgeLike> =
	| LayoutWorkerSuccess<E>
	| LayoutWorkerFailure;

/**
 * The async layout function `createLayoutWorker` returns: same signature as the
 * function from `createElkLayout`, so it is a drop-in replacement whether it runs
 * on a worker or the main thread.
 */
export type WorkerLayout = <N extends SizedNode, E extends DagEdgeLike>(
	nodes: readonly N[],
	edges: readonly E[],
) => Promise<ElkLayoutResult<E>>;

/** The handle returned by {@link createLayoutWorker}. */
export interface LayoutWorkerHandle {
	/** Lays the graph out — on the worker when available, else main-thread. */
	readonly layout: WorkerLayout;
	/** `true` when running off-thread, `false` for the SSR/no-worker fallback. */
	readonly usingWorker: boolean;
	/** Terminates the underlying worker (no-op for the fallback). Idempotent. */
	terminate(): void;
}

export interface CreateLayoutWorkerOptions {
	/** Default ELK options every `layout()` call is created with. */
	readonly layoutOptions?: ElkLayoutOptions;
	/**
	 * Builds the worker. Omit (or return on a platform without `Worker`) to use
	 * the main-thread fallback. A typical browser caller passes
	 * `() => new Worker(new URL('./layout.worker.js', import.meta.url), { type: 'module' })`.
	 */
	readonly workerFactory?: () => Worker;
	/**
	 * The main-thread layout used when no worker is available. Defaults to
	 * `createElkLayout`; injectable so the fallback path is testable without
	 * loading the real elkjs bundle.
	 */
	readonly fallbackFactory?: typeof createElkLayout;
}

/** True when this runtime can construct a `Worker` (browser, not SSR/Node). */
function workerIsAvailable(): boolean {
	return typeof Worker !== 'undefined';
}

function toMessage(reason: unknown): string {
	if (reason instanceof Error) return reason.message;
	if (typeof reason === 'string') return reason;
	return 'Unknown layout worker error';
}

function layoutWorkerProblem(detail: string, cause?: unknown): ProblemError {
	return new ProblemError({
		type: LAYOUT_WORKER_ERROR_TYPE,
		title: 'Flow layout failed',
		status: 500,
		detail,
		cause,
	});
}

/**
 * Drives a worker `port` (the `Worker` instance on the main side) through one
 * round-trip: posts a {@link LayoutWorkerRequest} and resolves with the matching
 * {@link ElkLayoutResult}. Listeners are scoped to the single request id and torn
 * down on settle so repeated calls do not leak handlers.
 */
function postLayout<N extends SizedNode, E extends DagEdgeLike>(
	worker: Worker,
	id: number,
	options: ElkLayoutOptions,
	nodes: readonly N[],
	edges: readonly E[],
): Promise<ElkLayoutResult<E>> {
	return new Promise<ElkLayoutResult<E>>((resolve, reject) => {
		const onMessage = (event: MessageEvent<LayoutWorkerResponse<E>>): void => {
			const data = event.data;
			if (!data || data.id !== id) return;
			cleanup();
			if (data.ok) resolve(data.result);
			else reject(layoutWorkerProblem(data.message));
		};
		const onError = (event: ErrorEvent): void => {
			cleanup();
			reject(layoutWorkerProblem(event.message || 'Layout worker crashed'));
		};
		function cleanup(): void {
			worker.removeEventListener('message', onMessage as EventListener);
			worker.removeEventListener('error', onError as EventListener);
		}
		worker.addEventListener('message', onMessage as EventListener);
		worker.addEventListener('error', onError as EventListener);
		const request: LayoutWorkerRequest<E> = {
			id,
			options,
			nodes: nodes.map((n) => ({ id: n.id, width: n.width, height: n.height })),
			edges,
		};
		worker.postMessage(request);
	});
}

/**
 * Creates a layout function that runs `createElkLayout` inside a Web Worker, with
 * a main-thread fallback for SSR or runtimes without `Worker`.
 *
 * - When `workerFactory` is supplied AND `Worker` exists, every `layout()` call
 *   is a postMessage round-trip; the worker module wires the other side with
 *   {@link layoutWorkerHandler}.
 * - Otherwise `layout()` calls `createElkLayout` on the calling thread. The
 *   public signature is identical either way, so callers swap transports without
 *   code changes.
 */
export function createLayoutWorker(
	options: CreateLayoutWorkerOptions = {},
): LayoutWorkerHandle {
	const {
		layoutOptions = {},
		workerFactory,
		fallbackFactory = createElkLayout,
	} = options;

	if (workerFactory && workerIsAvailable()) {
		let worker: Worker | undefined = workerFactory();
		let nextId = 0;
		const layout: WorkerLayout = async (nodes, edges) => {
			if (!worker) {
				throw layoutWorkerProblem('Layout worker has been terminated');
			}
			const id = nextId++;
			return postLayout(worker, id, layoutOptions, nodes, edges);
		};
		return {
			layout,
			usingWorker: true,
			terminate(): void {
				if (!worker) return;
				worker.terminate();
				worker = undefined;
			},
		};
	}

	// SSR / no-worker fallback: run on the main thread via createElkLayout.
	const mainThread = fallbackFactory(layoutOptions);
	const layout: WorkerLayout = (nodes, edges) => mainThread(nodes, edges);
	return {
		layout,
		usingWorker: false,
		terminate(): void {
			// No worker to terminate on the fallback path.
		},
	};
}

/**
 * The worker-side handler. A real worker entry module wires it as
 * `self.onmessage = layoutWorkerHandler((msg) => self.postMessage(msg))` (or via
 * `addEventListener('message', …)`); the same handler is driven directly in unit
 * tests against a fake `MessagePort`. `elkFactory` is injectable so tests can run
 * without the elkjs bundle. Errors are caught and posted back as a
 * {@link LayoutWorkerFailure} rather than throwing out of the worker.
 */
export function layoutWorkerHandler(
	post: (response: LayoutWorkerResponse) => void,
	elkFactory?: ElkFactory,
): (event: MessageEvent<LayoutWorkerRequest>) => Promise<void> {
	return async (event: MessageEvent<LayoutWorkerRequest>): Promise<void> => {
		const request = event.data;
		if (!request || typeof request.id !== 'number') return;
		try {
			const run = createElkLayout(request.options, elkFactory);
			const result = await run(request.nodes, request.edges);
			post({ id: request.id, ok: true, result });
		} catch (reason) {
			post({ id: request.id, ok: false, message: toMessage(reason) });
		}
	};
}
