import { describe, it, expect } from 'vitest';
import { validateUpload, detectFileType } from '../src/validate.js';
import { stripExif, readExif } from '../src/exif.js';

// Magic-byte fixtures: PNG signature + IHDR chunk (1x1), and a GIF89a header.
const PNG = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature
	0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR length + "IHDR"
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, // IHDR data
]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]);
// Minimal JPEG: SOI + APP1(Exif, one IFD0 ASCII tag Make="SVELTESENTIO") + EOI.
const JPEG_WITH_EXIF = new Uint8Array([
	255, 216, 255, 225, 0, 47, 69, 120, 105, 102, 0, 0, 73, 73, 42, 0, 8, 0, 0, 0, 1, 0, 15, 1,
	2, 0, 13, 0, 0, 0, 26, 0, 0, 0, 0, 0, 0, 0, 83, 86, 69, 76, 84, 69, 83, 69, 78, 84, 73, 79,
	0, 255, 217,
]);

describe('detectFileType (magic-byte sniff)', () => {
	it('detects png from content', async () => {
		expect(await detectFileType(PNG)).toEqual({ mime: 'image/png', ext: 'png' });
	});
	it('returns undefined for unrecognized bytes', async () => {
		expect(await detectFileType(new Uint8Array([1, 2, 3, 4]))).toBeUndefined();
	});
});

describe('validateUpload', () => {
	it('passes a png within the allowlist + size', async () => {
		const file = new Blob([PNG], { type: 'image/png' });
		const r = await validateUpload(file, { accept: ['image/png'], maxBytes: 1000 });
		expect(r.ok).toBe(true);
		expect(r.detectedType?.mime).toBe('image/png');
	});

	it('rejects a disguised type (File.type says png, bytes are gif)', async () => {
		const file = new Blob([GIF], { type: 'image/png' }); // lying Content-Type
		const r = await validateUpload(file, { accept: ['image/png'] });
		expect(r.ok).toBe(false);
		expect(r.detectedType?.mime).toBe('image/gif');
		expect(r.errors.join(' ')).toMatch(/not allowed/);
	});

	it('rejects oversized files', async () => {
		const file = new Blob([PNG], { type: 'image/png' });
		const r = await validateUpload(file, { maxBytes: 4 });
		expect(r.ok).toBe(false);
		expect(r.errors.join(' ')).toMatch(/maximum/);
	});

	it('reports an undetectable type when the allowlist is set but bytes are unknown', async () => {
		const file = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' });
		const r = await validateUpload(file, { accept: ['image/png'] });
		expect(r.ok).toBe(false);
		expect(r.detectedType).toBeUndefined();
		expect(r.errors.join(' ')).toMatch(/could not determine the file type/i);
	});

	it('passes with no options (no allowlist, no size cap)', async () => {
		const file = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' });
		const r = await validateUpload(file);
		expect(r.ok).toBe(true);
		expect(r.errors).toEqual([]);
	});
});

describe('stripExif (injected reencoder)', () => {
	it('re-encodes to a new File, dropping metadata', async () => {
		const input = new File([new Uint8Array([1, 2, 3])], 'photo.jpg', { type: 'image/jpeg' });
		const out = await stripExif(input, {
			reencode: async () => new Blob([new Uint8Array([9, 9])], { type: 'image/jpeg' }),
		});
		expect(out).toBeInstanceOf(File);
		expect(out.name).toBe('photo.jpg');
		expect(out.type).toBe('image/jpeg');
		expect(await out.arrayBuffer()).toEqual(new Uint8Array([9, 9]).buffer);
	});

	it('falls back to image/jpeg for a non-canvas-encodable input type', async () => {
		const input = new File([new Uint8Array([1, 2, 3])], 'scan.tiff', { type: 'image/tiff' });
		let seenType: string | undefined;
		const out = await stripExif(input, {
			reencode: async (_file, type) => {
				seenType = type;
				return new Blob([new Uint8Array([0])], { type });
			},
		});
		expect(seenType).toBe('image/jpeg');
		expect(out.type).toBe('image/jpeg');
	});

	it('honours an explicit output type + quality over the input type', async () => {
		const input = new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' });
		let seenQuality: number | undefined;
		const out = await stripExif(input, {
			type: 'image/webp',
			quality: 0.5,
			reencode: async (_file, _type, quality) => {
				seenQuality = quality;
				return new Blob([new Uint8Array([0])], { type: 'image/webp' });
			},
		});
		expect(out.type).toBe('image/webp');
		expect(seenQuality).toBe(0.5);
	});
});

describe('readExif', () => {
	// exifr's `Blob` path needs a browser `FileReader`; under Vitest's node env we
	// hand it the `ArrayBuffer` it can read directly (still a real exifr parse, no
	// mock). The `Blob`-typed signature is exercised in the browser at runtime.
	it('reads EXIF tags from a JPEG with an APP1 segment', async () => {
		const meta = await readExif(JPEG_WITH_EXIF.buffer as unknown as Blob);
		expect(meta).toBeDefined();
		expect(meta?.['Make']).toBe('SVELTESENTIO');
	});

	it('returns undefined when no metadata is present', async () => {
		// A bare SOI/EOI JPEG with no APP1 segment: exifr yields no parsable data.
		const empty = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
		expect(await readExif(empty.buffer as unknown as Blob)).toBeUndefined();
	});
});
