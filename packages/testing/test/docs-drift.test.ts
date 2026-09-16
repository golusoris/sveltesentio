import { describe, it, expect } from 'vitest';
import {
	exportKeys,
	diffKeys,
	findDrift,
	OPT_OUT,
	MAX_DIFF_FILES,
} from '../../../scripts/check-docs-drift.mjs';

const manifest = (exportsField: unknown) =>
	JSON.stringify({ name: '@sveltesentio/example', exports: exportsField });

describe('exportKeys (scripts/check-docs-drift.mjs)', () => {
	it('reads the key set from an exports map', () => {
		const keys = exportKeys(manifest({ '.': './src/index.ts', './clock': './src/clock.ts' }));
		expect([...(keys ?? [])].sort()).toEqual(['.', './clock']);
	});

	it('treats a string exports field as the single root entry point', () => {
		expect([...(exportKeys(manifest('./src/index.ts')) ?? [])]).toEqual(['.']);
	});

	it('returns an empty set for a manifest that publishes no exports map', () => {
		expect(exportKeys(JSON.stringify({ name: 'x' }))?.size).toBe(0);
	});

	// Boundary: "absent" and "exports nothing" must stay distinguishable, because
	// only the first means the package did not exist at that revision.
	it('returns null for an absent manifest', () => {
		expect(exportKeys(null)).toBeNull();
	});

	it('returns null for an empty or unparseable manifest rather than throwing', () => {
		expect(exportKeys('')).toBeNull();
		expect(exportKeys('   ')).toBeNull();
		expect(exportKeys('{ not json')).toBeNull();
	});
});

describe('diffKeys (scripts/check-docs-drift.mjs)', () => {
	it('reports an added subpath', () => {
		const before = exportKeys(manifest({ '.': './src/index.ts' }));
		const after = exportKeys(manifest({ '.': './src/index.ts', './eslint': './src/eslint.ts' }));
		expect(diffKeys(before, after)).toEqual({ added: ['./eslint'], removed: [] });
	});

	it('reports a removed subpath', () => {
		const before = exportKeys(manifest({ '.': './src/index.ts', './old': './src/old.ts' }));
		const after = exportKeys(manifest({ '.': './src/index.ts' }));
		expect(diffKeys(before, after)).toEqual({ added: [], removed: ['./old'] });
	});

	it('reports a rename as both sides, since consumers see a break either way', () => {
		const before = exportKeys(manifest({ './use-form': './src/use-form.ts' }));
		const after = exportKeys(manifest({ './form': './src/form.ts' }));
		expect(diffKeys(before, after)).toEqual({ added: ['./form'], removed: ['./use-form'] });
	});

	it('reports nothing when only the targets behind the keys change', () => {
		// Moving a file is not a surface change: the import path consumers write is
		// identical before and after.
		const before = exportKeys(manifest({ './clock': './src/clock.ts' }));
		const after = exportKeys(manifest({ './clock': './src/time/clock.ts' }));
		expect(diffKeys(before, after)).toEqual({ added: [], removed: [] });
	});

	// Boundary: a package added or deleted wholesale.
	it('reports nothing when the package did not exist on one side', () => {
		const keys = exportKeys(manifest({ '.': './src/index.ts' }));
		expect(diffKeys(null, keys)).toEqual({ added: [], removed: [] });
		expect(diffKeys(keys, null)).toEqual({ added: [], removed: [] });
	});
});

describe('findDrift (scripts/check-docs-drift.mjs)', () => {
	const change = {
		name: 'core',
		readme: 'packages/core/README.md',
		added: ['./eslint'],
		removed: [],
	};

	it('accuses when a subpath appears without a README edit', () => {
		const found = findDrift(
			[change],
			['packages/core/src/eslint.ts', 'packages/core/package.json'],
		);
		expect(found).toHaveLength(1);
		expect(found[0]).toContain('added ./eslint');
		expect(found[0]).toContain('packages/core/README.md');
	});

	it('stays silent when the README is edited in the same change', () => {
		const files = ['packages/core/src/eslint.ts', 'packages/core/README.md'];
		expect(findDrift([change], files)).toEqual([]);
	});

	it('stays silent when no package changed its entry points', () => {
		const unchanged = { ...change, added: [], removed: [] };
		expect(findDrift([unchanged], ['packages/core/src/http.ts'])).toEqual([]);
	});

	it('does not accept an ADR in place of the package README', () => {
		// An ADR records a decision; it does not describe the surface. Accepting one
		// would reduce the requirement to "it was written down somewhere".
		const files = ['packages/core/src/eslint.ts', 'docs/adr/0061-eslint-rule.md'];
		expect(findDrift([change], files)).toHaveLength(1);
	});

	it('accuses each package separately', () => {
		const other = {
			name: 'forms',
			readme: 'packages/forms/README.md',
			added: ['./use-form'],
			removed: [],
		};
		const found = findDrift([change, other], ['packages/forms/README.md']);
		expect(found).toHaveLength(1);
		expect(found[0]).toContain('core');
	});
});

describe('docs-drift opt-out and bounds', () => {
	it('recognises the opt-out phrase with a colon or a space', () => {
		expect(OPT_OUT.test('no docs needed: internal only')).toBe(true);
		expect(OPT_OUT.test('No Docs Needed - internal only')).toBe(true);
	});

	it('does not treat unrelated prose as an opt-out', () => {
		expect(OPT_OUT.test('This needs docs before it can merge.')).toBe(false);
		expect(OPT_OUT.test('no docs')).toBe(false);
	});

	it('bounds the diff it will consider (HISS-02)', () => {
		expect(MAX_DIFF_FILES).toBeGreaterThan(0);
		expect(Number.isFinite(MAX_DIFF_FILES)).toBe(true);
	});
});
