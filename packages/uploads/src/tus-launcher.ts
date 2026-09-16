import type { TusUpload, TusUploadConstructor, TusUploadOptions } from './resumable-types.js';

let cachedTusUpload: TusUploadConstructor | undefined;

/**
 * Resolves `tus-js-client`'s `Upload`, importing it once and reusing it after.
 *
 * Dynamic so the module stays SSR-safe: nothing pulls tus into a server bundle
 * that never starts an upload.
 */
async function loadTusUpload(): Promise<TusUploadConstructor> {
	if (!cachedTusUpload) {
		const mod = await import('tus-js-client');
		cachedTusUpload = mod.Upload;
	}
	return cachedTusUpload;
}

/**
 * Owns the tus instance and how it comes into being.
 *
 * `createResumableUpload` held this inline: the `tus` cell, an `instantiate`
 * helper, and a `begin` that branched between "the caller injected a
 * constructor, start now" and "import one, then start unless something raced
 * the import". That is a separate concern from the upload's state machine, and
 * it was the bulk of what made the factory 76 lines (HISS-04).
 *
 * Splitting it also makes the race testable on its own: the dynamic-import path
 * can be driven with a fake constructor and a `shouldProceed` that flips, with
 * no upload state to set up first.
 */
export interface TusLauncher {
	/** The server-assigned upload URL, or null before tus supplies one. */
	readonly url: string | null;
	/**
	 * Creates the tus upload and starts it.
	 *
	 * `shouldProceed` is consulted after the constructor resolves, because a
	 * pause or abort can race the dynamic import; when it returns false nothing
	 * is created. Failures to load or construct go to `onError`.
	 */
	start(shouldProceed: () => boolean, onError: (error: unknown) => void): void;
	/** Aborts the in-flight upload, if one exists. */
	abort(terminate: boolean): Promise<void>;
}

/**
 * Creates a launcher for `file`.
 *
 * `provided` short-circuits the dynamic import, which is how the lifecycle is
 * unit-tested against a fake constructor.
 */
export function createTusLauncher(
	file: Blob,
	tusOptions: TusUploadOptions,
	provided: TusUploadConstructor | undefined,
): TusLauncher {
	let tus: TusUpload | undefined;

	const instantiate = (Ctor: TusUploadConstructor): void => {
		tus = new Ctor(file, tusOptions);
		tus.start();
	};

	return {
		get url(): string | null {
			return tus?.url ?? null;
		},
		start(shouldProceed: () => boolean, onError: (error: unknown) => void): void {
			if (provided) {
				instantiate(provided);
				return;
			}
			void loadTusUpload().then(
				(Ctor) => {
					// A pause/abort may have raced the dynamic import; honour it.
					if (!shouldProceed()) return;
					instantiate(Ctor);
				},
				(error: unknown) => onError(error),
			);
		},
		async abort(terminate: boolean): Promise<void> {
			if (tus) await tus.abort(terminate);
		},
	};
}
