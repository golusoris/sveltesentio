// Runs one codemod step outside the checker's thread so a slow synchronous
// transform cannot pass an overdue timer, an active handle cannot keep the
// check alive, and a loop that never returns cannot hang it.
//
// Each call gets a fresh Worker, so module state cannot carry across calls
// and hide a transform that is not idempotent. The deadline lives in the
// parent thread; terminating the Worker also stops synchronous code.
import { pathToFileURL } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { withTimeout } from './check-template-labels.mjs';

/** @typedef {{ transformFile: string, mode: 'load' | 'call', source?: string, filePath?: string }} CodemodStep */
/** @typedef {CodemodStep & { timeoutMs: number, signal?: AbortSignal }} CodemodOptions */
/** @typedef {{ ok: false, kind: 'import' | 'export' | 'threw' | 'type' | 'timeout' | 'aborted' | 'crashed', message: string }} CodemodFailure */
/** @typedef {{ ok: true } | { ok: true, value: string } | CodemodFailure } CodemodResult */

/** @param {unknown} error */
export function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}

/** @param {unknown} value */
export function typeName(value) {
	if (value === null) return 'null';
	return Array.isArray(value) ? 'array' : typeof value;
}

/** @returns {CodemodFailure} */
function abortedResult() {
	return { ok: false, kind: 'aborted', message: 'codemod aborted by suite deadline' };
}

/** @param {Worker | undefined} worker @returns {Promise<CodemodFailure | null>} */
async function terminateWorker(worker) {
	try {
		await worker?.terminate();
		return null;
	} catch (error) {
		return { ok: false, kind: 'crashed', message: `cannot terminate: ${errorMessage(error)}` };
	}
}

/**
 * Runs one step in a fresh Worker and always terminates it before returning.
 * @param {CodemodOptions} options
 * @returns {Promise<CodemodResult>}
 */
export async function runCodemod({
	transformFile,
	mode,
	source = '',
	filePath = '',
	timeoutMs,
	signal,
}) {
	if (signal?.aborted) return abortedResult();
	let worker;
	/** @type {(() => void) | undefined} */
	let onAbort;
	/** @type {CodemodResult} */
	let outcome;
	try {
		worker = new Worker(new URL(import.meta.url), {
			workerData: { codemodWorker: true, transformFile, mode, source, filePath },
		});
		/** @type {Promise<CodemodResult>} */
		const result = new Promise((resolve) => {
			worker.once('message', resolve);
			worker.once('error', (error) => {
				resolve({ ok: false, kind: 'crashed', message: errorMessage(error) });
			});
			worker.once('exit', (code) => {
				resolve({ ok: false, kind: 'crashed', message: `exited with code ${code}` });
			});
			onAbort = () => resolve(abortedResult());
			signal?.addEventListener('abort', onAbort, { once: true });
			if (signal?.aborted) onAbort();
		});
		try {
			outcome = await withTimeout(result, timeoutMs, 'codemod');
		} catch (error) {
			outcome = { ok: false, kind: 'timeout', message: errorMessage(error) };
		}
	} catch (error) {
		outcome = { ok: false, kind: 'crashed', message: errorMessage(error) };
	} finally {
		if (onAbort) signal?.removeEventListener('abort', onAbort);
		const failure = await terminateWorker(worker);
		if (failure) outcome = failure;
	}
	return outcome;
}

/** @param {CodemodStep} options @returns {Promise<CodemodResult>} */
async function executeCodemod({ transformFile, mode, source = '', filePath = '' }) {
	let mod;
	try {
		mod = await import(pathToFileURL(transformFile).href);
	} catch (error) {
		return { ok: false, kind: 'import', message: errorMessage(error) };
	}
	if (typeof mod.default !== 'function') {
		return { ok: false, kind: 'export', message: 'must default-export a function' };
	}
	if (mode === 'load') return { ok: true };
	let value;
	try {
		value = await mod.default(source, filePath);
	} catch (error) {
		return { ok: false, kind: 'threw', message: errorMessage(error) };
	}
	if (typeof value !== 'string') {
		return { ok: false, kind: 'type', message: typeName(value) };
	}
	return { ok: true, value };
}

if (!isMainThread && parentPort && workerData?.codemodWorker === true) {
	// A pending promise alone does not keep a Worker alive until its deadline.
	parentPort.ref();
	parentPort.postMessage(await executeCodemod(workerData));
}
