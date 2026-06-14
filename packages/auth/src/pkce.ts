import { base64UrlEncode, randomBase64Url, randomBytes } from './random.js';

export interface PkceChallenge {
	verifier: string;
	challenge: string;
	method: 'S256';
}

export async function generatePkceChallenge(): Promise<PkceChallenge> {
	const verifier = randomBase64Url(64);
	const challenge = await codeChallengeS256(verifier);
	return { verifier, challenge, method: 'S256' };
}

export async function codeChallengeS256(verifier: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(verifier),
	);
	return base64UrlEncode(new Uint8Array(digest));
}

export function generateVerifier(byteLength = 64): string {
	return base64UrlEncode(randomBytes(byteLength));
}
