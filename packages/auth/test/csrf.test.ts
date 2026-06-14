import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	issueCsrfToken,
	timingSafeEqual,
	verifyCsrfToken,
} from '../src/csrf.js';
import { randomBytes } from '../src/random.js';

const SECRET = randomBytes(32);
const SESSION_ID = 'sess_01H8YABQZ0F3K7V9W2R3X5Y6Z7';

describe('CSRF double-submit token', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-04-18T00:00:00Z'));
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('issues a token that verifies against the same session + secret', async () => {
		const { token, exp } = await issueCsrfToken(SESSION_ID, SECRET);
		expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(exp).toBeGreaterThan(Date.now());
		expect(await verifyCsrfToken(token, SESSION_ID, SECRET)).toBe(true);
	});

	it('rejects token bound to a different session id', async () => {
		const { token } = await issueCsrfToken(SESSION_ID, SECRET);
		expect(await verifyCsrfToken(token, 'sess_different', SECRET)).toBe(false);
	});

	it('rejects token signed with a different secret', async () => {
		const { token } = await issueCsrfToken(SESSION_ID, SECRET);
		const otherSecret = randomBytes(32);
		expect(await verifyCsrfToken(token, SESSION_ID, otherSecret)).toBe(false);
	});

	it('rejects expired tokens', async () => {
		const { token } = await issueCsrfToken(SESSION_ID, SECRET, { ttlMs: 1000 });
		vi.advanceTimersByTime(2000);
		expect(await verifyCsrfToken(token, SESSION_ID, SECRET)).toBe(false);
	});

	it('rejects malformed input (not base64url, wrong length)', async () => {
		expect(await verifyCsrfToken('', SESSION_ID, SECRET)).toBe(false);
		expect(await verifyCsrfToken('too-short', SESSION_ID, SECRET)).toBe(false);
		expect(await verifyCsrfToken('!!!not-b64!!!', SESSION_ID, SECRET)).toBe(false);
	});

	it('rejects if a single byte flips (HMAC mismatch)', async () => {
		const { token } = await issueCsrfToken(SESSION_ID, SECRET);
		const tampered =
			token.slice(0, 10) +
			(token[10] === 'A' ? 'B' : 'A') +
			token.slice(11);
		expect(await verifyCsrfToken(tampered, SESSION_ID, SECRET)).toBe(false);
	});
});

describe('timingSafeEqual', () => {
	it('returns true for identical arrays', () => {
		const a = new Uint8Array([1, 2, 3, 4]);
		const b = new Uint8Array([1, 2, 3, 4]);
		expect(timingSafeEqual(a, b)).toBe(true);
	});

	it('returns false for length mismatch', () => {
		expect(timingSafeEqual(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
	});

	it('returns false for content mismatch', () => {
		expect(
			timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])),
		).toBe(false);
	});
});
