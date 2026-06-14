import { describe, it, expect } from 'vitest';
import {
	UNSAFE_EVAL,
	WASM_UNSAFE_EVAL,
	emulatorCspDirectives,
	mergeCspDirectives,
	originOf,
} from '../src/csp.js';

describe('originOf', () => {
	it('extracts the origin from an absolute URL', () => {
		expect(originOf('https://cdn.example.com/emulatorjs/data/')).toBe(
			'https://cdn.example.com',
		);
		expect(originOf('https://cdn.example.com:8443/x')).toBe(
			'https://cdn.example.com:8443',
		);
	});

	it('returns undefined for relative / empty URLs', () => {
		expect(originOf('/emulatorjs/data/')).toBeUndefined();
		expect(originOf('')).toBeUndefined();
		expect(originOf(undefined)).toBeUndefined();
	});
});

describe('emulatorCspDirectives', () => {
	it('grants wasm-unsafe-eval + blob in script-src by default', () => {
		const d = emulatorCspDirectives();
		expect(d['script-src']).toContain(WASM_UNSAFE_EVAL);
		expect(d['script-src']).toContain('blob:');
		expect(d['script-src']).toContain("'self'");
		expect(d['script-src']).not.toContain(UNSAFE_EVAL);
	});

	it('falls back to unsafe-eval when wasmEvalFallback is set', () => {
		const d = emulatorCspDirectives({ wasmEvalFallback: true });
		expect(d['script-src']).toContain(UNSAFE_EVAL);
		expect(d['script-src']).not.toContain(WASM_UNSAFE_EVAL);
	});

	it('allows blob: workers and child-src for the core bootstrap', () => {
		const d = emulatorCspDirectives();
		expect(d['worker-src']).toEqual(["'self'", 'blob:']);
		expect(d['child-src']).toEqual(["'self'", 'blob:']);
	});

	it('adds the data base origin to connect/img/media when absolute', () => {
		const d = emulatorCspDirectives({
			dataBaseUrl: 'https://roms.example.com/data/',
		});
		expect(d['connect-src']).toContain('https://roms.example.com');
		expect(d['img-src']).toContain('https://roms.example.com');
		expect(d['media-src']).toContain('https://roms.example.com');
	});

	it('omits a data origin for same-origin (relative) data paths', () => {
		const d = emulatorCspDirectives({ dataBaseUrl: '/emulatorjs/data/' });
		expect(d['connect-src']).toEqual(["'self'"]);
		// img/media still need self/blob/data for the canvas + inline art.
		expect(d['img-src']).toEqual(["'self'", 'blob:', 'data:']);
	});

	it('threads extra script origins into script/worker/connect', () => {
		const cdn = 'https://cdn.emulatorjs.org';
		const d = emulatorCspDirectives({ extraScriptOrigins: [cdn] });
		expect(d['script-src']).toContain(cdn);
		expect(d['worker-src']).toContain(cdn);
		expect(d['connect-src']).toContain(cdn);
	});

	it('produces de-duplicated source lists', () => {
		const d = emulatorCspDirectives({
			dataBaseUrl: 'https://x.example',
			extraScriptOrigins: ["'self'", 'https://x.example'],
		});
		for (const list of Object.values(d)) {
			expect(new Set(list).size).toBe(list?.length);
		}
	});
});

describe('mergeCspDirectives', () => {
	it('unions source arrays per directive without dropping base sources', () => {
		const base = {
			'default-src': ["'self'"],
			'script-src': ["'strict-dynamic'", "'nonce-abc'"],
			'object-src': ["'none'"],
		};
		const merged = mergeCspDirectives(base, emulatorCspDirectives());
		expect(merged['script-src']).toContain("'strict-dynamic'");
		expect(merged['script-src']).toContain("'nonce-abc'");
		expect(merged['script-src']).toContain(WASM_UNSAFE_EVAL);
		expect(merged['script-src']).toContain('blob:');
		// untouched base directives survive
		expect(merged['default-src']).toEqual(["'self'"]);
		expect(merged['object-src']).toEqual(["'none'"]);
	});

	it('introduces directives absent from the base (worker-src/child-src)', () => {
		const merged = mergeCspDirectives({ 'default-src': ["'self'"] }, emulatorCspDirectives());
		expect(merged['worker-src']).toEqual(["'self'", 'blob:']);
		expect(merged['child-src']).toEqual(["'self'", 'blob:']);
	});

	it('preserves boolean/string base directives untouched', () => {
		const base = {
			'script-src': ["'self'"],
			'upgrade-insecure-requests': true,
			'report-to': 'csp-endpoint',
		};
		const merged = mergeCspDirectives(base, emulatorCspDirectives());
		expect(merged['upgrade-insecure-requests']).toBe(true);
		expect(merged['report-to']).toBe('csp-endpoint');
	});

	it('does not mutate the base object', () => {
		const base = { 'script-src': ["'self'"] };
		const snapshot = JSON.stringify(base);
		mergeCspDirectives(base, emulatorCspDirectives());
		expect(JSON.stringify(base)).toBe(snapshot);
	});

	it('de-duplicates after merge when base already lists a source', () => {
		const base = { 'script-src': ["'self'", 'blob:'] };
		const merged = mergeCspDirectives(base, emulatorCspDirectives());
		const selfCount = merged['script-src']?.filter((s) => s === "'self'").length;
		const blobCount = merged['script-src']?.filter((s) => s === 'blob:').length;
		expect(selfCount).toBe(1);
		expect(blobCount).toBe(1);
	});
});
