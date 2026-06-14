import { describe, expect, it } from 'vitest';
import {
	codeChallengeS256,
	generatePkceChallenge,
	generateVerifier,
} from '../src/pkce.js';

describe('PKCE helpers', () => {
	it('generates a verifier + S256 challenge', async () => {
		const { verifier, challenge, method } = await generatePkceChallenge();
		expect(method).toBe('S256');
		expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(verifier.length).toBeGreaterThanOrEqual(43);
		expect(verifier).not.toBe(challenge);
	});

	it('codeChallengeS256 is deterministic for a given verifier', async () => {
		const verifier = generateVerifier(32);
		const a = await codeChallengeS256(verifier);
		const b = await codeChallengeS256(verifier);
		expect(a).toBe(b);
	});

	it('RFC 7636 appendix-B vector round-trips', async () => {
		const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
		const challenge = await codeChallengeS256(verifier);
		expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
	});

	it('generatePkceChallenge yields unique verifiers', async () => {
		const a = await generatePkceChallenge();
		const b = await generatePkceChallenge();
		expect(a.verifier).not.toBe(b.verifier);
	});
});
