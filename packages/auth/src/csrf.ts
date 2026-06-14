import { base64UrlDecode, base64UrlEncode, randomBytes } from './random.js';

const NONCE_BYTES = 16;
const HMAC_BYTES = 32;
const DEFAULT_TTL_MS = 60 * 60 * 1000;

export interface IssuedCsrfToken {
	token: string;
	exp: number;
}

export interface CsrfIssueOptions {
	ttlMs?: number;
}

export async function issueCsrfToken(
	sessionId: string,
	secret: Uint8Array | ArrayBuffer,
	options: CsrfIssueOptions = {},
): Promise<IssuedCsrfToken> {
	const nonce = randomBytes(NONCE_BYTES);
	const exp = Date.now() + (options.ttlMs ?? DEFAULT_TTL_MS);
	const tag = await hmac(secret, buildPayload(nonce, sessionId, exp));
	const combined = concat(nonce, tag, encodeExp(exp));
	return { token: base64UrlEncode(combined), exp };
}

export async function verifyCsrfToken(
	token: string,
	sessionId: string,
	secret: Uint8Array | ArrayBuffer,
): Promise<boolean> {
	let buf: Uint8Array;
	try {
		buf = base64UrlDecode(token);
	} catch {
		return false;
	}
	if (buf.length !== NONCE_BYTES + HMAC_BYTES + 8) return false;

	const nonce = buf.subarray(0, NONCE_BYTES);
	const tag = buf.subarray(NONCE_BYTES, NONCE_BYTES + HMAC_BYTES);
	const expBytes = buf.subarray(NONCE_BYTES + HMAC_BYTES);
	const exp = decodeExp(expBytes);
	if (!Number.isFinite(exp) || Date.now() > exp) return false;

	const expected = await hmac(secret, buildPayload(nonce, sessionId, exp));
	return timingSafeEqual(tag, expected);
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i += 1) {
		diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
	}
	return diff === 0;
}

async function hmac(
	secret: Uint8Array | ArrayBuffer,
	data: Uint8Array,
): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey(
		'raw',
		toBufferSource(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);
	const sig = await crypto.subtle.sign('HMAC', key, toBufferSource(data));
	return new Uint8Array(sig);
}

function toBufferSource(value: Uint8Array | ArrayBuffer): ArrayBuffer {
	if (value instanceof ArrayBuffer) return value;
	const copy = new ArrayBuffer(value.byteLength);
	new Uint8Array(copy).set(value);
	return copy;
}

function buildPayload(nonce: Uint8Array, sessionId: string, exp: number): Uint8Array {
	const sid = new TextEncoder().encode(sessionId);
	return concat(nonce, sid, encodeExp(exp));
}

function encodeExp(exp: number): Uint8Array {
	const buf = new ArrayBuffer(8);
	new DataView(buf).setBigUint64(0, BigInt(exp), false);
	return new Uint8Array(buf);
}

function decodeExp(bytes: Uint8Array): number {
	return Number(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(0, false));
}

function concat(...parts: Uint8Array[]): Uint8Array {
	const total = parts.reduce((sum, p) => sum + p.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const p of parts) {
		out.set(p, offset);
		offset += p.length;
	}
	return out;
}
