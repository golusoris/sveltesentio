// Guards exact Playwright specifiers in lockfile importers (merge-stragglers
// finding on PR 400: a caret range let lock file maintenance resolve a second
// Playwright version).
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { stringify } from 'yaml';
import {
	EXACT_VERSION_REGEX,
	findPlaywrightSpecifierViolations,
	getPlaywrightLockVersion,
	IMPORTER_LIMIT,
	main,
	PLAYWRIGHT_PACKAGES,
} from './check-playwright-image.mjs';

const VALID_IMAGE =
	'mcr.microsoft.com/playwright:v1.64.1-resolute@sha256:f76885029244e5a384243a930ff283cef67d90653978ee27a77dd4cff8882fb4';

const DEFAULT_DOC1_IMPORTERS = {
	'.': {
		packageManagerDependencies: {
			pnpm: { specifier: '12.14.0', version: '12.14.0' },
		},
	},
};

const DEFAULT_DOC1_PACKAGES = {
	'pnpm@12.14.0': { resolution: {} },
};

const DEFAULT_DOC2_PACKAGES = {
	'playwright@1.64.1': { resolution: {} },
};

const INVALID_SPECIFIERS = [
	'^1.63.0',
	'~1.64.1',
	'>=1.64.0',
	'*',
	'latest',
	'1.64',
	'1.64.1-alpha-2026',
	'workspace:*',
	'npm:playwright@1.64.1',
];

function makeTwoDocLockfile({
	doc1Importers = DEFAULT_DOC1_IMPORTERS,
	doc1Packages = DEFAULT_DOC1_PACKAGES,
	doc2Importers = {},
	doc2Packages = DEFAULT_DOC2_PACKAGES,
} = {}) {
	const doc1 = stringify(
		{ lockfileVersion: '9.0', importers: doc1Importers, packages: doc1Packages },
		{ singleQuote: true },
	);
	const doc2 = stringify(
		{ lockfileVersion: '9.0', importers: doc2Importers, packages: doc2Packages },
		{ singleQuote: true },
	);
	return `---\n${doc1}---\n${doc2}`;
}

function makeValidWorkflow() {
	return [
		'jobs:',
		'  e2e:',
		'    runs-on: ubuntu-26.04',
		'    container:',
		`      image: ${VALID_IMAGE}`,
		'      options: --user 1001',
		'    env:',
		'      PLAYWRIGHT_BROWSERS_PATH: /ms-playwright',
		'    steps:',
		'      - run: pnpm exec turbo run test:e2e',
		'',
	].join('\n');
}

async function setupFixtureDir(tempRoot, name, lockYaml) {
	const dir = join(tempRoot, name);
	await mkdir(join(dir, '.github', 'workflows'), { recursive: true });
	await writeFile(join(dir, 'pnpm-lock.yaml'), lockYaml);
	await writeFile(join(dir, '.github', 'workflows', 'ci.yml'), makeValidWorkflow());
	await writeFile(
		join(dir, 'turbo.json'),
		JSON.stringify({
			tasks: {
				'test:e2e': { passThroughEnv: ['PLAYWRIGHT_BROWSERS_PATH'] },
			},
		}),
	);
	return dir;
}

describe('check-playwright-image exact specifier pins', () => {
	let tempRoot;

	before(async () => {
		tempRoot = await mkdtemp(join(tmpdir(), 'cpi-pins-test-'));
	});

	after(async () => {
		if (tempRoot) {
			await rm(tempRoot, { recursive: true, force: true });
		}
	});

	describe('positive cases', () => {
		it('accepts exact 1.64.1 for all three names across two importers and both docs', () => {
			const names = [...PLAYWRIGHT_PACKAGES].sort();
			assert.deepEqual(names, ['@playwright/test', 'playwright', 'playwright-core']);
			assert.equal(EXACT_VERSION_REGEX.test('1.64.1'), true);
			assert.equal(IMPORTER_LIMIT, 1_000);

			const yaml = makeTwoDocLockfile({
				doc1Importers: {
					'apps/storybook': {
						devDependencies: {
							playwright: { specifier: '1.64.1', version: '1.64.1' },
						},
					},
				},
				doc2Importers: {
					'packages/media': {
						devDependencies: {
							'@playwright/test': { specifier: '1.64.1', version: '1.64.1' },
						},
					},
					'packages/shell': {
						dependencies: {
							'playwright-core': { specifier: '1.64.1', version: '1.64.1' },
						},
					},
				},
			});

			const result = getPlaywrightLockVersion(yaml);
			assert.equal(result.version, '1.64.1');
			assert.equal(result.finding, null);
			assert.deepEqual(result.specifierFindings, []);
		});

		it('accepts version with peer suffix 1.64.1(foo@1.0.0) and exact specifier 1.64.1', () => {
			const yaml = makeTwoDocLockfile({
				doc2Importers: {
					'packages/shell': {
						devDependencies: {
							'@playwright/test': { specifier: '1.64.1', version: '1.64.1(foo@1.0.0)' },
						},
					},
				},
			});

			const result = getPlaywrightLockVersion(yaml);
			assert.equal(result.version, '1.64.1');
			assert.equal(result.finding, null);
			assert.deepEqual(result.specifierFindings, []);
		});

		it('ignores @axe-core/playwright and @vitest/browser-playwright beside exact pins', () => {
			const yaml = makeTwoDocLockfile({
				doc2Importers: {
					'apps/storybook': {
						devDependencies: {
							'@playwright/test': { specifier: '1.64.1', version: '1.64.1' },
							playwright: { specifier: '1.64.1', version: '1.64.1' },
							'@vitest/browser-playwright': {
								specifier: '^5.0.0',
								version: '5.0.5(playwright@1.64.1)',
							},
							'@playwright/mcp': {
								specifier: '^0.0.20',
								version: '0.0.25',
							},
						},
					},
					'packages/shell': {
						devDependencies: {
							'@axe-core/playwright': {
								specifier: '^4.13.0',
								version: '4.14.0(playwright-core@1.64.1)',
							},
							'@playwright/test': { specifier: '1.64.1', version: '1.64.1' },
						},
					},
				},
			});

			const result = getPlaywrightLockVersion(yaml);
			assert.equal(result.version, '1.64.1');
			assert.equal(result.finding, null);
			assert.deepEqual(result.specifierFindings, []);
		});

		it('returns 0 from main(dir) on temporary directory with exact pins', async () => {
			const yaml = makeTwoDocLockfile({
				doc2Importers: {
					'apps/storybook': {
						devDependencies: {
							'@playwright/test': { specifier: '1.64.1', version: '1.64.1' },
							playwright: { specifier: '1.64.1', version: '1.64.1' },
						},
					},
				},
			});
			const dir = await setupFixtureDir(tempRoot, 'exact-ok', yaml);
			assert.equal(await main(dir), 0);
		});
	});

	describe('negative cases', () => {
		it('refuses planted main caret specifier in packages/media devDependencies', () => {
			const yaml = makeTwoDocLockfile({
				doc2Importers: {
					'packages/media': {
						devDependencies: {
							'@playwright/test': { specifier: '^1.63.0', version: '1.64.1' },
						},
					},
				},
			});

			const result = getPlaywrightLockVersion(yaml);
			assert.equal(result.version, '1.64.1');
			assert.equal(result.finding, null);
			assert.equal(result.specifierFindings.length, 1);
			const [finding] = result.specifierFindings;
			assert.equal(finding.file, 'pnpm-lock.yaml');
			assert.equal(finding.job, null);
			assert.match(finding.message, /packages\/media/);
			assert.match(finding.message, /devDependencies/);
			assert.match(finding.message, /@playwright\/test/);
			assert.match(finding.message, /\^1\.63\.0/);
			assert.match(finding.message, /1\.64\.1/);
			assert.match(finding.message, /container image/);
		});

		it('refuses every non-exact specifier shape', () => {
			for (const specifier of INVALID_SPECIFIERS) {
				assert.equal(
					EXACT_VERSION_REGEX.test(specifier),
					false,
					`expected EXACT_VERSION_REGEX to refuse ${specifier}`,
				);

				const directFindings = findPlaywrightSpecifierViolations(
					[
						{
							importers: {
								'apps/storybook': {
									devDependencies: {
										playwright: { specifier, version: specifier },
									},
								},
							},
						},
					],
					null,
				);
				assert.equal(
					directFindings.length,
					1,
					`expected findPlaywrightSpecifierViolations to refuse ${specifier}`,
				);

				const yaml = makeTwoDocLockfile({
					doc2Importers: {
						'apps/storybook': {
							devDependencies: {
								playwright: { specifier, version: '1.64.1' },
							},
						},
					},
				});
				const result = getPlaywrightLockVersion(yaml);
				assert.equal(
					result.specifierFindings.length,
					1,
					`expected getPlaywrightLockVersion to refuse ${specifier}`,
				);
			}
		});

		it('refuses missing specifier and numeric non-string specifier', () => {
			const missingYaml = makeTwoDocLockfile({
				doc2Importers: {
					'packages/media': {
						devDependencies: {
							'@playwright/test': { version: '1.64.1' },
						},
					},
				},
			});
			assert.equal(getPlaywrightLockVersion(missingYaml).specifierFindings.length, 1);

			const numericYaml = makeTwoDocLockfile({
				doc2Importers: {
					'packages/media': {
						devDependencies: {
							'@playwright/test': { specifier: 1.64, version: '1.64.1' },
						},
					},
				},
			});
			assert.equal(getPlaywrightLockVersion(numericYaml).specifierFindings.length, 1);
		});

		it('scans dependencies and optionalDependencies sections', () => {
			const depsYaml = makeTwoDocLockfile({
				doc2Importers: {
					'packages/media': {
						dependencies: {
							playwright: { specifier: '^1.64.1', version: '1.64.1' },
						},
					},
				},
			});
			const depsFindings = getPlaywrightLockVersion(depsYaml).specifierFindings;
			assert.equal(depsFindings.length, 1);
			assert.match(depsFindings[0].message, /dependencies/);
			assert.match(depsFindings[0].message, /playwright/);

			const optYaml = makeTwoDocLockfile({
				doc2Importers: {
					'packages/shell': {
						optionalDependencies: {
							'playwright-core': { specifier: '~1.64.1', version: '1.64.1' },
						},
					},
				},
			});
			const optFindings = getPlaywrightLockVersion(optYaml).specifierFindings;
			assert.equal(optFindings.length, 1);
			assert.match(optFindings[0].message, /optionalDependencies/);
			assert.match(optFindings[0].message, /playwright-core/);
		});

		it('refuses a range appearing only in the second YAML document', () => {
			const yaml = makeTwoDocLockfile({
				doc1Importers: { '.': {} },
				doc2Importers: {
					'packages/shell': {
						devDependencies: {
							'@playwright/test': { specifier: '^1.63.0', version: '1.64.1' },
						},
					},
				},
			});
			const result = getPlaywrightLockVersion(yaml);
			assert.equal(result.specifierFindings.length, 1);
			assert.match(result.specifierFindings[0].message, /packages\/shell/);
		});

		it('refuses exact 1.64.0 with version 1.64.0 when resolved version is 1.64.1', () => {
			const driftedSingleLock = makeTwoDocLockfile({
				doc2Importers: {
					'packages/media': {
						devDependencies: {
							'@playwright/test': { specifier: '1.64.0', version: '1.64.0' },
						},
					},
				},
				doc2Packages: {
					'playwright@1.64.1': { resolution: {} },
					'@playwright/test@1.64.0': { resolution: {} },
				},
			});
			const singleResult = getPlaywrightLockVersion(driftedSingleLock);
			assert.equal(singleResult.version, '1.64.1');
			assert.equal(singleResult.finding, null);
			assert.equal(singleResult.specifierFindings.length, 1);
			assert.match(singleResult.specifierFindings[0].message, /1\.64\.0/);
			assert.match(singleResult.specifierFindings[0].message, /1\.64\.1/);

			const twoVersionLock = makeTwoDocLockfile({
				doc2Importers: {
					'apps/storybook': {
						devDependencies: {
							playwright: { specifier: '^1.63.0', version: '1.64.0' },
						},
					},
				},
				doc2Packages: {
					'playwright@1.64.1': { resolution: {} },
					'playwright@1.64.0': { resolution: {} },
				},
			});
			const twoVersionResult = getPlaywrightLockVersion(twoVersionLock);
			assert.equal(twoVersionResult.version, null);
			assert.match(twoVersionResult.finding.message, /expected exactly one playwright version/);
			assert.equal(twoVersionResult.specifierFindings.length, 1);
		});

		it('returns 1 from main(dir) with the planted caret case', async () => {
			const yaml = makeTwoDocLockfile({
				doc2Importers: {
					'packages/media': {
						devDependencies: {
							'@playwright/test': { specifier: '^1.63.0', version: '1.64.1' },
						},
					},
				},
			});
			const dir = await setupFixtureDir(tempRoot, 'planted-caret-fail', yaml);
			assert.equal(await main(dir), 1);
		});
	});

	describe('boundary cases', () => {
		it('accepts empty importers and importer with no dependency sections', () => {
			const yaml = makeTwoDocLockfile({
				doc1Importers: {},
				doc2Importers: {
					'packages/empty': {},
					'packages/nullish': null,
				},
			});
			const result = getPlaywrightLockVersion(yaml);
			assert.equal(result.version, '1.64.1');
			assert.equal(result.finding, null);
			assert.deepEqual(result.specifierFindings, []);
		});

		it('enforces importerLimit at exact count and one over', () => {
			const yaml = makeTwoDocLockfile({
				doc1Importers: { '.': {} },
				doc2Importers: {
					'apps/docs': {
						devDependencies: {
							'@playwright/test': { specifier: '1.64.1', version: '1.64.1' },
						},
					},
					'packages/auth': {
						devDependencies: {
							'@playwright/test': { specifier: '1.64.1', version: '1.64.1' },
						},
					},
				},
			});

			const atLimit = getPlaywrightLockVersion(yaml, { importerLimit: 3 });
			assert.equal(atLimit.version, '1.64.1');
			assert.equal(atLimit.finding, null);
			assert.deepEqual(atLimit.specifierFindings, []);

			const overLimit = getPlaywrightLockVersion(yaml, { importerLimit: 2 });
			assert.equal(overLimit.version, null);
			assert.match(
				overLimit.finding.message,
				/pnpm-lock\.yaml exceeds limit of 2 importers, got 3/,
			);
			assert.deepEqual(overLimit.specifierFindings, []);
		});

		it('returns empty array from findPlaywrightSpecifierViolations([], "1.64.1")', () => {
			assert.deepEqual(findPlaywrightSpecifierViolations([], '1.64.1'), []);
		});
	});
});
