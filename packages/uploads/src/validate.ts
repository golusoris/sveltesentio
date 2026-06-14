import { fileTypeFromBlob, fileTypeFromBuffer } from 'file-type';

export interface DetectedFileType {
	mime: string;
	ext: string;
}

export interface ValidateUploadOptions {
	/** Allowed MIME types, matched against the *sniffed* type — never `File.type`. */
	accept?: readonly string[];
	/** Maximum byte size. */
	maxBytes?: number;
}

export interface ValidateUploadResult {
	ok: boolean;
	/** Type sniffed from magic bytes, or `undefined` if unrecognized. */
	detectedType: DetectedFileType | undefined;
	size: number;
	errors: string[];
}

/**
 * Validate a `File`/`Blob` by sniffing its real content type from magic bytes
 * (never trusting `File.type`, which is attacker-controlled) and checking it
 * against an allowlist + size cap. Transport-agnostic — runs before any upload,
 * with no dependency on tus or the resumable path.
 */
export async function validateUpload(
	file: Blob,
	options: ValidateUploadOptions = {},
): Promise<ValidateUploadResult> {
	const errors: string[] = [];
	const size = file.size;

	if (options.maxBytes !== undefined && size > options.maxBytes) {
		errors.push(`File is ${size} bytes; the maximum is ${options.maxBytes}.`);
	}

	const sniffed = await fileTypeFromBlob(file);
	const detectedType: DetectedFileType | undefined = sniffed
		? { mime: sniffed.mime, ext: sniffed.ext }
		: undefined;

	if (options.accept && options.accept.length > 0) {
		if (!detectedType) {
			errors.push('Could not determine the file type from its content.');
		} else if (!options.accept.includes(detectedType.mime)) {
			errors.push(`Content type "${detectedType.mime}" is not allowed.`);
		}
	}

	return { ok: errors.length === 0, detectedType, size, errors };
}

/** Sniff a type from a raw byte buffer (server-side / non-`Blob` inputs). */
export async function detectFileType(
	bytes: Uint8Array,
): Promise<DetectedFileType | undefined> {
	const sniffed = await fileTypeFromBuffer(bytes);
	return sniffed ? { mime: sniffed.mime, ext: sniffed.ext } : undefined;
}
