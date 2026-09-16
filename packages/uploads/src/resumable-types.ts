/**
 * The tus-facing type surface, split out so `tus-launcher.ts` can name these
 * without importing `resumable.ts` — which imports the launcher, and would make
 * the pair a cycle. HISS-01 forbids that, and `pnpm check:cycles` reports it.
 */

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
export type TusUploadConstructor = new (file: Blob, options: TusUploadOptions) => TusUpload;
