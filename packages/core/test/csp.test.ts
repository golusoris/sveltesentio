import { describe, expect, it } from 'vitest';
import {
	NONE,
	SELF,
	createNonce,
	hashSource,
	nonceSource,
	serialiseCsp,
	strictCsp,
} from '../src/csp';
import { isIdV4 } from '../src/id';

describe('createNonce', () => {
	it('returns a valid UUIDv4', () => {
		expect(isIdV4(createNonce())).toBe(true);
	});

	it('is unique per call', () => {
		const a = createNonce();
		const b = createNonce();
		expect(a).not.toBe(b);
	});
});

describe('nonceSource / hashSource', () => {
	it('wraps nonces in the CSP keyword', () => {
		expect(nonceSource('abc')).toBe("'nonce-abc'");
	});

	it('wraps hashes with algorithm prefix', () => {
		expect(hashSource('sha256', 'xxx')).toBe("'sha256-xxx'");
	});
});

describe('strictCsp + serialiseCsp', () => {
	it('serialises a strict policy with nonce, strict-dynamic, no inline, and upgrade-insecure', () => {
		const nonce = 'NONCE';
		const header = serialiseCsp(strictCsp({ nonce }));
		expect(header).toContain("default-src 'self'");
		expect(header).toContain("script-src 'strict-dynamic' 'nonce-NONCE'");
		expect(header).toContain("object-src 'none'");
		expect(header).toContain("base-uri 'none'");
		expect(header).toContain("frame-ancestors 'none'");
		expect(header).toContain('upgrade-insecure-requests');
		expect(header).not.toContain("'unsafe-inline'");
		expect(header).not.toContain("'unsafe-eval'");
	});

	it('includes report-uri when provided', () => {
		const header = serialiseCsp(strictCsp({ nonce: 'N', reportUri: '/csp' }));
		expect(header).toContain('report-uri /csp');
	});

	it('omits empty arrays + false booleans', () => {
		const header = serialiseCsp({
			'default-src': [SELF],
			'img-src': [],
			'upgrade-insecure-requests': false,
		});
		expect(header).toBe("default-src 'self'");
	});

	it('NONE constant renders as none', () => {
		const header = serialiseCsp({ 'object-src': [NONE] });
		expect(header).toBe("object-src 'none'");
	});

	it('serialises a string-valued directive (report-to) verbatim', () => {
		const header = serialiseCsp({ 'report-to': 'csp-endpoint' });
		expect(header).toBe('report-to csp-endpoint');
	});

	it('combines string and array directives in one header', () => {
		const header = serialiseCsp({
			'default-src': [SELF],
			'report-to': 'group-1',
			'upgrade-insecure-requests': true,
		});
		expect(header).toContain("default-src 'self'");
		expect(header).toContain('report-to group-1');
		expect(header).toContain('upgrade-insecure-requests');
	});
});
