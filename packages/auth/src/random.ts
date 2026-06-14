export function base64UrlEncode(bytes: Uint8Array): string {
	let binary = '';
	for (const b of bytes) binary += String.fromCharCode(b);
	const b64 = btoa(binary);
	return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(value: string): Uint8Array {
	const normalised = value.replace(/-/g, '+').replace(/_/g, '/');
	const padding = normalised.length % 4 === 0 ? 0 : 4 - (normalised.length % 4);
	const padded = normalised + '='.repeat(padding);
	const binary = atob(padded);
	const out = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
	return out;
}

export function randomBytes(length: number): Uint8Array {
	if (length <= 0 || !Number.isInteger(length)) {
		throw new RangeError(`randomBytes length must be a positive integer, got ${length}`);
	}
	const out = new Uint8Array(length);
	crypto.getRandomValues(out);
	return out;
}

export function randomBase64Url(byteLength = 32): string {
	return base64UrlEncode(randomBytes(byteLength));
}

export function generateState(): string {
	return randomBase64Url(32);
}

export function generateNonce(): string {
	return randomBase64Url(32);
}
