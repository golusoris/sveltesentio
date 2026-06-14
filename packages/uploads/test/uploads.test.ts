import { describe, it, expect } from 'vitest';
import { validateUpload, detectFileType } from '../src/validate.js';
import { stripExif } from '../src/exif.js';

// Magic-byte fixtures: PNG signature + IHDR chunk (1x1), and a GIF89a header.
const PNG = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature
	0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR length + "IHDR"
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, // IHDR data
]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]);

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
});
