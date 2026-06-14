import { parse as parseExif } from 'exifr';

const CANVAS_ENCODABLE = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Re-encode an image to a metadata-free blob. */
export type Reencoder = (file: Blob, type: string, quality: number) => Promise<Blob>;

export interface StripExifOptions {
	/** Output MIME type. Defaults to the input type if canvas-encodable, else `image/jpeg`. */
	type?: string;
	/** JPEG/WebP quality, 0–1 (default 0.92). */
	quality?: number;
	/** Injected re-encoder — defaults to a browser `OffscreenCanvas` re-encode. */
	reencode?: Reencoder;
}

const canvasReencode: Reencoder = async (file, type, quality) => {
	const bitmap = await createImageBitmap(file);
	try {
		const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('2D canvas context is unavailable');
		ctx.drawImage(bitmap, 0, 0);
		return await canvas.convertToBlob({ type, quality });
	} finally {
		bitmap.close();
	}
};

/**
 * Destructively strip EXIF (and all other) metadata by re-encoding the image —
 * the only reliable, privacy-safe approach (GPS/orientation/thumbnails are all
 * dropped). Browser-only by default; inject `reencode` for tests or workers.
 */
export async function stripExif(file: File, options: StripExifOptions = {}): Promise<File> {
	const type = options.type ?? (CANVAS_ENCODABLE.has(file.type) ? file.type : 'image/jpeg');
	const quality = options.quality ?? 0.92;
	const reencode = options.reencode ?? canvasReencode;
	const stripped = await reencode(file, type, quality);
	return new File([stripped], file.name, { type });
}

/** Read EXIF metadata (e.g. to warn about embedded GPS before stripping). */
export async function readExif(file: Blob): Promise<Record<string, unknown> | undefined> {
	const data: unknown = await parseExif(file);
	return data ? (data as Record<string, unknown>) : undefined;
}
