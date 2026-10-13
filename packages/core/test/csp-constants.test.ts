import { describe, expect, it } from 'vitest';
import { STRICT_DYNAMIC, serialiseCsp, strictCsp } from '../src/csp.js';

describe('CSP constants', () => {
	it('exports STRICT_DYNAMIC with the exact single-quoted CSP keyword value', () => {
		expect(STRICT_DYNAMIC).toBe("'strict-dynamic'");
	});

	it('uses STRICT_DYNAMIC in strictCsp builder output for script-src', () => {
		const nonce = 'test-nonce-constant-check';
		const directives = strictCsp({ nonce });

		expect(directives['script-src']).toBeDefined();
		expect(directives['script-src']).toContain(STRICT_DYNAMIC);
		expect(directives['script-src']?.[0]).toBe(STRICT_DYNAMIC);
		expect(directives['script-src']?.[1]).toBe(`'nonce-${nonce}'`);

		const header = serialiseCsp(directives);
		expect(header).toContain(`script-src ${STRICT_DYNAMIC} 'nonce-${nonce}'`);
	});

	it('boundary/negative: STRICT_DYNAMIC is omitted from directives where not specified', () => {
		const directives = strictCsp({ nonce: 'n' });

		expect(directives['default-src']).not.toContain(STRICT_DYNAMIC);
		expect(directives['style-src']).not.toContain(STRICT_DYNAMIC);
		expect(directives['connect-src']).not.toContain(STRICT_DYNAMIC);
		expect(directives['font-src']).not.toContain(STRICT_DYNAMIC);
		expect(directives['img-src']).not.toContain(STRICT_DYNAMIC);

		// Manual directive set omitting STRICT_DYNAMIC does not serialise it
		const customHeader = serialiseCsp({
			'default-src': ["'self'"],
			'script-src': ["'self'"],
		});
		expect(customHeader).not.toContain(STRICT_DYNAMIC);
	});
});
