import { describe, expect, it } from 'vitest';
import {
	base64UrlDecode,
	base64UrlEncode,
	generateNonce,
	generateState,
	randomBase64Url,
	randomBytes,
} from '../src/random.js';

describe('randomBytes', () => {
	it('returns Uint8Array of requested length', () => {
		const out = randomBytes(32);
		expect(out).toBeInstanceOf(Uint8Array);
		expect(out.length).toBe(32);
	});

	it('rejects non-positive / non-integer lengths', () => {
		expect(() => randomBytes(0)).toThrow(RangeError);
		expect(() => randomBytes(-1)).toThrow(RangeError);
		expect(() => randomBytes(1.5)).toThrow(RangeError);
	});

	it('produces statistically-unique outputs across calls', () => {
		const a = randomBase64Url(32);
		const b = randomBase64Url(32);
		expect(a).not.toBe(b);
	});
});

describe('base64UrlEncode/Decode', () => {
	it('round-trips arbitrary bytes', () => {
		for (let i = 0; i < 20; i += 1) {
			const bytes = randomBytes(8 + (i % 16));
			const encoded = base64UrlEncode(bytes);
			expect(encoded).not.toMatch(/[+/=]/);
			const decoded = base64UrlDecode(encoded);
			expect([...decoded]).toEqual([...bytes]);
		}
	});

	it('produces URL-safe output (no padding / plus / slash)', () => {
		const encoded = base64UrlEncode(new Uint8Array([255, 254, 253, 252, 251]));
		expect(encoded).not.toMatch(/[+/=]/);
	});
});

describe('state + nonce generators', () => {
	it('emit URL-safe base64 of 32-byte randomness', () => {
		const state = generateState();
		const nonce = generateNonce();
		expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(state).not.toBe(nonce);
	});
});
