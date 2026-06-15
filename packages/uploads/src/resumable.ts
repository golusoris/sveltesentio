import { ProblemError } from '@sveltesentio/core';

// Resumable upload wrapper over `tus-js-client` (peer dep, ADR-0041). The tus
// `Upload` constructor is injected so the lifecycle unit-tests with a fake — no
// network, no real protocol. The default constructor is lazily imported inside
// `start()` to stay SSR-safe and keep tus a true peer (never bundled here).

const RESUMABLE_PROBLEM_TYPE = 'https://sveltesentio.dev/problems/upload-failed';

/** Minimal structural view of the tus `Upload` options this wrapper drives. */
export interface TusUploadOptions {
	endpoint?: string | null;
	uploadUrl?: string | null;
	metadata?: Record<string, string>;
	chunkSize?: number;
	retryDelays?: number[] | null;
	headers?: Record<string, string>;
	onProgress?: ((bytesSent: number, bytesTotal: number) => void) | null;
	onSuccess?: ((payload: unknown) => void) | null;
	onError?: ((error: Error) => void) | null;
}

/** Minimal structural view of the tus `Upload` instance this wrapper drives. */
export interface TusUpload {
	readonly url: string | null;
	start(): void;
	abort(shouldTerminate?: boolean): Promise<void>;
}

/**
 * The tus `Upload` constructor shape. Defaults to `tus-js-client`'s `Upload`;
 * inject a fake in tests to drive lifecycle/progress without a server.
 */
export type TusUploadConstructor = new (
	file: Blob,
	options: TusUploadOptions,
) => TusUpload;

/** Lifecycle phase of a {@link ResumableUpload}. */
export type ResumableState =
	| 'idle'
	| 'uploading'
	| 'paused'
	| 'success'
	| 'error'
	| 'aborted';

/** Progress snapshot emitted on every tus `onProgress` tick. */
export interface ResumableProgress {
	/** Bytes transferred so far. */
	bytesSent: number;
	/** Total bytes to transfer. */
	bytesTotal: number;
	/** Fraction transferred in `[0, 1]`; `0` when total is unknown/zero. */
	fraction: number;
	/** Percent transferred in `[0, 100]`, rounded to two decimals. */
	percent: number;
}

/** Options for {@link createResumableUpload}. */
export interface ResumableUploadOptions {
	/** tus server endpoint (creation URL). Required unless `uploadUrl` resumes one. */
	endpoint?: string;
	/** Resume a known upload URL instead of creating a new one. */
	uploadUrl?: string;
	/** tus metadata (e.g. `{ filename, filetype }`). */
	metadata?: Record<string, string>;
	/** Chunk size in bytes. Omit to let tus upload in a single request. */
	chunkSize?: number;
	/** Retry backoff delays in ms. `[]` disables retries; `null` uses tus defaults. */
	retryDelays?: number[] | null;
	/** Extra request headers (e.g. auth). */
	headers?: Record<string, string>;
	/** Progress callback, invoked on every tus tick. */
	onProgress?: (progress: ResumableProgress) => void;
	/** Success callback, invoked once the upload completes. */
	onSuccess?: (upload: ResumableUpload) => void;
	/** Error callback. Receives a {@link ProblemError} wrapping the tus error. */
	onError?: (error: ProblemError) => void;
	/**
	 * Injected tus `Upload` constructor. Defaults to `tus-js-client`'s `Upload`
	 * (lazily imported on first `start()`); inject a fake for unit tests.
	 */
	UploadConstructor?: TusUploadConstructor;
}

/** Handle returned by {@link createResumableUpload}. */
export interface ResumableUpload {
	/** Current lifecycle phase. */
	readonly state: ResumableState;
	/** Latest progress snapshot. */
	readonly progress: ResumableProgress;
	/** tus upload URL once assigned by the server, else `null`. */
	readonly url: string | null;
	/** Begin (or resume after pause) the transfer. */
	start(): void;
	/** Pause the transfer, retaining progress for a later `resume`. */
	pause(): void;
	/** Resume a paused transfer. Alias of {@link start} from the `paused` state. */
	resume(): void;
	/** Abort the transfer. Pass `terminate` to also delete the server-side upload. */
	abort(terminate?: boolean): Promise<void>;
}

function clampFraction(bytesSent: number, bytesTotal: number): number {
	if (bytesTotal <= 0) return 0;
	const fraction = bytesSent / bytesTotal;
	if (fraction < 0) return 0;
	if (fraction > 1) return 1;
	return fraction;
}

function toProgress(bytesSent: number, bytesTotal: number): ResumableProgress {
	const fraction = clampFraction(bytesSent, bytesTotal);
	return {
		bytesSent,
		bytesTotal,
		fraction,
		percent: Math.round(fraction * 10000) / 100,
	};
}

function toProblem(error: Error): ProblemError {
	if (error instanceof ProblemError) return error;
	return new ProblemError({
		type: RESUMABLE_PROBLEM_TYPE,
		title: 'Resumable upload failed',
		detail: error.message,
		cause: error,
	});
}

let cachedTusUpload: TusUploadConstructor | undefined;

async function loadTusUpload(): Promise<TusUploadConstructor> {
	if (!cachedTusUpload) {
		const mod = await import('tus-js-client');
		cachedTusUpload = mod.Upload;
	}
	return cachedTusUpload;
}

/**
 * Create a resumable upload over tus with start/pause/resume/abort control and
 * progress/success/error callbacks.
 *
 * The transfer is lazy: nothing happens until {@link ResumableUpload.start}. The
 * tus `Upload` constructor is injected (`opts.UploadConstructor`) so the full
 * lifecycle unit-tests against a fake; the production default is `tus-js-client`'s
 * `Upload`, dynamically imported on first `start()` to stay SSR-safe.
 *
 * `pause` aborts the in-flight tus request without terminating the server-side
 * upload, so `resume` continues from the last accepted byte. tus owns retries
 * via `retryDelays`; no second retry layer is wrapped here (per AGENTS.md).
 *
 * @throws {ProblemError} synchronously from `start()` when neither `endpoint`
 *   nor `uploadUrl` is provided.
 */
export function createResumableUpload(
	file: Blob,
	options: ResumableUploadOptions,
): ResumableUpload {
	if (options.endpoint === undefined && options.uploadUrl === undefined) {
		throw new ProblemError({
			type: RESUMABLE_PROBLEM_TYPE,
			title: 'Resumable upload misconfigured',
			status: 422,
			detail: 'Either `endpoint` or `uploadUrl` is required.',
		});
	}

	let state: ResumableState = 'idle';
	let progress: ResumableProgress = toProgress(0, Math.max(file.size, 0));
	let tus: TusUpload | undefined;

	const tusOptions: TusUploadOptions = {
		...(options.endpoint !== undefined ? { endpoint: options.endpoint } : {}),
		...(options.uploadUrl !== undefined ? { uploadUrl: options.uploadUrl } : {}),
		...(options.metadata !== undefined ? { metadata: options.metadata } : {}),
		...(options.chunkSize !== undefined ? { chunkSize: options.chunkSize } : {}),
		...(options.retryDelays !== undefined ? { retryDelays: options.retryDelays } : {}),
		...(options.headers !== undefined ? { headers: options.headers } : {}),
		onProgress: (bytesSent: number, bytesTotal: number): void => {
			progress = toProgress(bytesSent, bytesTotal);
			options.onProgress?.(progress);
		},
		onSuccess: (): void => {
			state = 'success';
			options.onSuccess?.(handle);
		},
		onError: (error: Error): void => {
			state = 'error';
			options.onError?.(toProblem(error));
		},
	};

	function instantiate(Ctor: TusUploadConstructor): TusUpload {
		const created = new Ctor(file, tusOptions);
		tus = created;
		return created;
	}

	function begin(): void {
		state = 'uploading';
		if (options.UploadConstructor) {
			instantiate(options.UploadConstructor).start();
			return;
		}
		void loadTusUpload().then(
			(Ctor) => {
				// A pause/abort may have raced the dynamic import; honour it.
				if (state !== 'uploading') return;
				instantiate(Ctor).start();
			},
			(error: unknown) => {
				state = 'error';
				options.onError?.(toProblem(error instanceof Error ? error : new Error(String(error))));
			},
		);
	}

	const handle: ResumableUpload = {
		get state(): ResumableState {
			return state;
		},
		get progress(): ResumableProgress {
			return progress;
		},
		get url(): string | null {
			return tus?.url ?? null;
		},
		start(): void {
			if (state === 'uploading' || state === 'success') return;
			begin();
		},
		pause(): void {
			if (state !== 'uploading') return;
			state = 'paused';
			if (tus) void tus.abort(false);
		},
		resume(): void {
			if (state !== 'paused') return;
			begin();
		},
		async abort(terminate = false): Promise<void> {
			if (state === 'success' || state === 'aborted') return;
			state = 'aborted';
			if (tus) await tus.abort(terminate);
		},
	};

	return handle;
}
