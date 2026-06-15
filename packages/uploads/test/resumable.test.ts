import { describe, it, expect, vi } from 'vitest';
import { ProblemError } from '@sveltesentio/core';
import { createResumableUpload } from '../src/resumable.js';
import type {
	TusUpload,
	TusUploadConstructor,
	TusUploadOptions,
} from '../src/resumable.js';

// Fake tus `Upload`: records the options it was constructed with and exposes the
// captured callbacks so a test can drive progress/success/error with no network.
class FakeUpload implements TusUpload {
	static last: FakeUpload | undefined;
	static instances = 0;

	url: string | null = null;
	started = 0;
	aborted: boolean[] = [];
	readonly options: TusUploadOptions;

	constructor(
		public readonly file: Blob,
		options: TusUploadOptions,
	) {
		this.options = options;
		FakeUpload.last = this;
		FakeUpload.instances += 1;
	}

	start(): void {
		this.started += 1;
		this.url = 'https://tus.example/files/abc';
	}

	abort(shouldTerminate = false): Promise<void> {
		this.aborted.push(shouldTerminate);
		return Promise.resolve();
	}

	emitProgress(sent: number, total: number): void {
		this.options.onProgress?.(sent, total);
	}

	emitSuccess(): void {
		this.options.onSuccess?.({ lastResponse: {} });
	}

	emitError(error: Error): void {
		this.options.onError?.(error);
	}
}

function fresh(): TusUploadConstructor {
	FakeUpload.last = undefined;
	FakeUpload.instances = 0;
	return FakeUpload as unknown as TusUploadConstructor;
}

function blob(bytes = 100): Blob {
	return new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' });
}

describe('createResumableUpload — construction', () => {
	it('throws a ProblemError when neither endpoint nor uploadUrl is given', () => {
		expect(() => createResumableUpload(blob(), {} as never)).toThrow(ProblemError);
		try {
			createResumableUpload(blob(), {} as never);
		} catch (e) {
			expect(e).toBeInstanceOf(ProblemError);
			expect((e as ProblemError).status).toBe(422);
		}
	});

	it('starts idle and lazily — no tus instance until start()', () => {
		const Ctor = fresh();
		const up = createResumableUpload(blob(), {
			endpoint: '/tus',
			UploadConstructor: Ctor,
		});
		expect(up.state).toBe('idle');
		expect(up.url).toBeNull();
		expect(FakeUpload.instances).toBe(0);
	});

	it('passes retryDelays, chunkSize, headers and metadata through to tus', () => {
		const Ctor = fresh();
		const up = createResumableUpload(blob(), {
			endpoint: '/tus',
			chunkSize: 5 * 1024 * 1024,
			retryDelays: [0, 1000, 3000, 5000],
			headers: { authorization: 'Bearer t' },
			metadata: { filename: 'a.bin', filetype: 'application/octet-stream' },
			UploadConstructor: Ctor,
		});
		up.start();
		const opts = FakeUpload.last?.options;
		expect(opts?.endpoint).toBe('/tus');
		expect(opts?.chunkSize).toBe(5 * 1024 * 1024);
		expect(opts?.retryDelays).toEqual([0, 1000, 3000, 5000]);
		expect(opts?.headers).toEqual({ authorization: 'Bearer t' });
		expect(opts?.metadata).toEqual({ filename: 'a.bin', filetype: 'application/octet-stream' });
	});

	it('omits retryDelays entirely when not provided (lets tus default)', () => {
		const Ctor = fresh();
		const up = createResumableUpload(blob(), { endpoint: '/tus', UploadConstructor: Ctor });
		up.start();
		expect(FakeUpload.last?.options).not.toHaveProperty('retryDelays');
	});

	it('forwards retryDelays: [] (caller explicitly disabling retries)', () => {
		const Ctor = fresh();
		const up = createResumableUpload(blob(), {
			endpoint: '/tus',
			retryDelays: [],
			UploadConstructor: Ctor,
		});
		up.start();
		expect(FakeUpload.last?.options.retryDelays).toEqual([]);
	});
});

describe('createResumableUpload — lifecycle', () => {
	it('start() transitions idle -> uploading and calls tus start once', () => {
		const Ctor = fresh();
		const up = createResumableUpload(blob(), { endpoint: '/tus', UploadConstructor: Ctor });
		up.start();
		expect(up.state).toBe('uploading');
		expect(FakeUpload.last?.started).toBe(1);
		expect(up.url).toBe('https://tus.example/files/abc');
	});

	it('start() is idempotent while uploading (no second tus instance)', () => {
		const Ctor = fresh();
		const up = createResumableUpload(blob(), { endpoint: '/tus', UploadConstructor: Ctor });
		up.start();
		up.start();
		expect(FakeUpload.instances).toBe(1);
	});

	it('pause() transitions uploading -> paused and aborts without terminating', () => {
		const Ctor = fresh();
		const up = createResumableUpload(blob(), { endpoint: '/tus', UploadConstructor: Ctor });
		up.start();
		up.pause();
		expect(up.state).toBe('paused');
		expect(FakeUpload.last?.aborted).toEqual([false]);
	});

	it('pause() is a no-op when not uploading', () => {
		const Ctor = fresh();
		const up = createResumableUpload(blob(), { endpoint: '/tus', UploadConstructor: Ctor });
		up.pause();
		expect(up.state).toBe('idle');
	});

	it('resume() transitions paused -> uploading and re-instantiates tus', () => {
		const Ctor = fresh();
		const up = createResumableUpload(blob(), { endpoint: '/tus', UploadConstructor: Ctor });
		up.start();
		up.pause();
		up.resume();
		expect(up.state).toBe('uploading');
		expect(FakeUpload.instances).toBe(2);
	});

	it('resume() is a no-op when not paused', () => {
		const Ctor = fresh();
		const up = createResumableUpload(blob(), { endpoint: '/tus', UploadConstructor: Ctor });
		up.start();
		up.resume();
		expect(FakeUpload.instances).toBe(1);
	});

	it('success transitions to success and fires onSuccess with the handle', () => {
		const Ctor = fresh();
		const onSuccess = vi.fn();
		const up = createResumableUpload(blob(), {
			endpoint: '/tus',
			onSuccess,
			UploadConstructor: Ctor,
		});
		up.start();
		FakeUpload.last?.emitSuccess();
		expect(up.state).toBe('success');
		expect(onSuccess).toHaveBeenCalledWith(up);
	});

	it('start() after success is a no-op', () => {
		const Ctor = fresh();
		const up = createResumableUpload(blob(), { endpoint: '/tus', UploadConstructor: Ctor });
		up.start();
		FakeUpload.last?.emitSuccess();
		up.start();
		expect(FakeUpload.instances).toBe(1);
		expect(up.state).toBe('success');
	});

	it('abort() transitions to aborted and terminates when asked', async () => {
		const Ctor = fresh();
		const up = createResumableUpload(blob(), { endpoint: '/tus', UploadConstructor: Ctor });
		up.start();
		await up.abort(true);
		expect(up.state).toBe('aborted');
		expect(FakeUpload.last?.aborted).toEqual([true]);
	});

	it('abort() after success is a no-op', async () => {
		const Ctor = fresh();
		const up = createResumableUpload(blob(), { endpoint: '/tus', UploadConstructor: Ctor });
		up.start();
		FakeUpload.last?.emitSuccess();
		await up.abort();
		expect(up.state).toBe('success');
		expect(FakeUpload.last?.aborted).toEqual([]);
	});
});

describe('createResumableUpload — progress math', () => {
	it('computes fraction and percent from tus ticks', () => {
		const Ctor = fresh();
		const ticks: number[] = [];
		const up = createResumableUpload(blob(200), {
			endpoint: '/tus',
			onProgress: (p) => ticks.push(p.percent),
			UploadConstructor: Ctor,
		});
		up.start();
		FakeUpload.last?.emitProgress(50, 200);
		expect(up.progress.fraction).toBe(0.25);
		expect(up.progress.percent).toBe(25);
		FakeUpload.last?.emitProgress(133, 200);
		expect(up.progress.percent).toBe(66.5);
		expect(ticks).toEqual([25, 66.5]);
	});

	it('clamps fraction to [0,1] and guards a zero total', () => {
		const Ctor = fresh();
		const up = createResumableUpload(blob(), { endpoint: '/tus', UploadConstructor: Ctor });
		up.start();
		FakeUpload.last?.emitProgress(10, 0);
		expect(up.progress.fraction).toBe(0);
		expect(up.progress.percent).toBe(0);
		FakeUpload.last?.emitProgress(120, 100);
		expect(up.progress.fraction).toBe(1);
		expect(up.progress.percent).toBe(100);
	});

	it('seeds initial progress from the file size', () => {
		const Ctor = fresh();
		const up = createResumableUpload(blob(512), { endpoint: '/tus', UploadConstructor: Ctor });
		expect(up.progress.bytesTotal).toBe(512);
		expect(up.progress.bytesSent).toBe(0);
		expect(up.progress.percent).toBe(0);
	});
});

describe('createResumableUpload — error mapping', () => {
	it('wraps a tus Error in a ProblemError and transitions to error', () => {
		const Ctor = fresh();
		const onError = vi.fn();
		const up = createResumableUpload(blob(), {
			endpoint: '/tus',
			onError,
			UploadConstructor: Ctor,
		});
		up.start();
		FakeUpload.last?.emitError(new Error('network down'));
		expect(up.state).toBe('error');
		expect(onError).toHaveBeenCalledTimes(1);
		const problem = onError.mock.calls[0]?.[0] as ProblemError;
		expect(problem).toBeInstanceOf(ProblemError);
		expect(problem.detail).toBe('network down');
		expect(problem.cause).toBeInstanceOf(Error);
	});

	it('passes a ProblemError through unwrapped', () => {
		const Ctor = fresh();
		const onError = vi.fn();
		const original = new ProblemError({ type: 'urn:x', title: 'boom', status: 500 });
		const up = createResumableUpload(blob(), {
			endpoint: '/tus',
			onError,
			UploadConstructor: Ctor,
		});
		up.start();
		FakeUpload.last?.emitError(original);
		const problem = onError.mock.calls[0]?.[0] as ProblemError;
		expect(problem).toBe(original);
	});
});
