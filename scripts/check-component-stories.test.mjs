import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	findComponentsWithoutStory,
	hasComponentImport,
	hasStoryCovers,
	walk,
} from './check-component-stories.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** @param {string} dir @param {Record<string, string>} files */
async function writeTree(dir, files) {
	for (const [path, content] of Object.entries(files)) {
		await mkdir(dirname(join(dir, path)), { recursive: true });
		await writeFile(join(dir, path), content);
	}
}

describe('check-component-stories', () => {
	/** @type {string} */
	let tempRoot;

	before(async () => {
		tempRoot = await mkdtemp(join(tmpdir(), 'ccs-test-'));
	});

	after(async () => {
		if (tempRoot) {
			await rm(tempRoot, { recursive: true, force: true });
		}
	});

	describe('hasComponentImport', () => {
		it('detects static default import', () => {
			assert.ok(hasComponentImport("import Button from './Button.svelte';", 'Button'));
		});

		it('detects static named import', () => {
			assert.ok(hasComponentImport("import { Button, Input } from './components.js';", 'Button'));
		});

		it('detects multiline named import', () => {
			const source = `import {
				ProcessNode,
				DecisionNode,
			} from '../nodes.js';`;
			assert.ok(hasComponentImport(source, 'ProcessNode'));
			assert.ok(hasComponentImport(source, 'DecisionNode'));
			assert.ok(!hasComponentImport(source, 'DataNode'));
		});

		it('ignores mentions inside comments when not in imports', () => {
			assert.ok(!hasComponentImport('// ProcessNode is used here', 'ProcessNode'));
			assert.ok(!hasComponentImport('/* <ProcessNode> component docs */', 'ProcessNode'));
		});
	});

	describe('hasStoryCovers', () => {
		it('detects component with em dash and reason', () => {
			const source = '// story-covers: Button — renders button in canvas';
			assert.ok(hasStoryCovers(source, 'Button'));
		});

		it('detects component with spaced hyphen and reason', () => {
			const source = '// story-covers: Button - renders button in canvas';
			assert.ok(hasStoryCovers(source, 'Button'));
		});

		it('detects component in HTML comment with reason', () => {
			const source = '<!-- story-covers: Button — renders button in canvas -->';
			assert.ok(hasStoryCovers(source, 'Button'));
		});

		it('detects multiple comma-separated components', () => {
			const source =
				'// story-covers: ProcessNode, DecisionNode, DataNode — rendered through FlowCanvas nodeTypes';
			assert.ok(hasStoryCovers(source, 'ProcessNode'));
			assert.ok(hasStoryCovers(source, 'DecisionNode'));
			assert.ok(hasStoryCovers(source, 'DataNode'));
			assert.ok(!hasStoryCovers(source, 'OtherNode'));
		});

		it('rejects declaration without reason delimiter', () => {
			assert.ok(!hasStoryCovers('// story-covers: Button', 'Button'));
			assert.ok(!hasStoryCovers('<!-- story-covers: Button -->', 'Button'));
		});

		it('rejects declaration with empty reason after delimiter', () => {
			assert.ok(!hasStoryCovers('// story-covers: Button —   ', 'Button'));
			assert.ok(!hasStoryCovers('// story-covers: Button -   ', 'Button'));
			assert.ok(!hasStoryCovers('<!-- story-covers: Button — -->', 'Button'));
			assert.ok(!hasStoryCovers('<!-- story-covers: Button — --!>', 'Button'));
			assert.ok(!hasStoryCovers('<!-- story-covers: Button - -->', 'Button'));
		});

		it('boundary: substring of another listed name does not match', () => {
			assert.ok(!hasStoryCovers('// story-covers: ButtonGroup — reason', 'Button'));
			assert.ok(!hasStoryCovers('// story-covers: ProcessNode, DecisionNode — reason', 'Node'));
		});
	});

	describe('walk', () => {
		it('collects all .svelte files and ignores node_modules', async () => {
			const dir = join(tempRoot, 'walk-test');
			await writeTree(dir, {
				'a/Comp.svelte': '',
				'a/Comp.stories.svelte': '',
				'node_modules/ignore/Ignored.svelte': '',
				'b/sub/Deep.svelte': '',
			});
			const files = await walk(dir);
			assert.equal(files.length, 3);
			assert.ok(files.some((f) => f.endsWith('Comp.svelte')));
			assert.ok(files.some((f) => f.endsWith('Comp.stories.svelte')));
			assert.ok(files.some((f) => f.endsWith('Deep.svelte')));
			assert.ok(!files.some((f) => f.includes('node_modules')));
		});
	});

	describe('findComponentsWithoutStory', () => {
		it('missing story fails', async () => {
			const packages = join(tempRoot, 'fixture-missing');
			const compPath = join(packages, 'demo/src/Button.svelte');
			await writeTree(packages, {
				'demo/package.json': JSON.stringify({ name: '@fixture/demo' }),
				'demo/src/Button.svelte': '<button></button>',
			});
			const missing = await findComponentsWithoutStory(packages);
			assert.deepEqual(missing, [compPath]);
		});

		it('sibling story passes', async () => {
			const packages = join(tempRoot, 'fixture-sibling');
			await writeTree(packages, {
				'demo/package.json': JSON.stringify({ name: '@fixture/demo' }),
				'demo/src/Button.svelte': '<button></button>',
				'demo/src/Button.stories.svelte': '<script module></script>',
			});
			const missing = await findComponentsWithoutStory(packages);
			assert.deepEqual(missing, []);
		});

		it('story elsewhere in package importing it passes', async () => {
			const packages = join(tempRoot, 'fixture-imported');
			await writeTree(packages, {
				'demo/package.json': JSON.stringify({ name: '@fixture/demo' }),
				'demo/src/nodes/ProcessNode.svelte': '<div>Process</div>',
				'demo/src/nodes/ExampleNodes.stories.svelte':
					"import ProcessNode from './ProcessNode.svelte';",
			});
			const missing = await findComponentsWithoutStory(packages);
			assert.deepEqual(missing, []);
		});

		it('story-covers with reason covers (positive)', async () => {
			const packages = join(tempRoot, 'fixture-story-covers-positive');
			await writeTree(packages, {
				'demo/package.json': JSON.stringify({ name: '@fixture/demo' }),
				'demo/src/nodes/ProcessNode.svelte': '<div>Process</div>',
				'demo/src/nodes/DecisionNode.svelte': '<div>Decision</div>',
				'demo/src/nodes/DataNode.svelte': '<div>Data</div>',
				'demo/src/nodes/ExampleNodes.stories.svelte':
					'// story-covers: ProcessNode, DecisionNode, DataNode — rendered through FlowCanvas nodeTypes\n',
			});
			const missing = await findComponentsWithoutStory(packages);
			assert.deepEqual(missing, []);
		});

		it('story-covers without reason does not (negative)', async () => {
			const packages = join(tempRoot, 'fixture-story-covers-negative');
			const compPath = join(packages, 'demo/src/Button.svelte');
			await writeTree(packages, {
				'demo/package.json': JSON.stringify({ name: '@fixture/demo' }),
				'demo/src/Button.svelte': '<button></button>',
				'demo/src/All.stories.svelte': '// story-covers: Button\n',
			});
			const missing = await findComponentsWithoutStory(packages);
			assert.deepEqual(missing, [compPath]);
		});

		it('name only as substring of another listed name does not count (boundary)', async () => {
			const packages = join(tempRoot, 'fixture-substring-boundary');
			const compPath = join(packages, 'demo/src/Button.svelte');
			await writeTree(packages, {
				'demo/package.json': JSON.stringify({ name: '@fixture/demo' }),
				'demo/src/Button.svelte': '<button></button>',
				'demo/src/All.stories.svelte': '// story-covers: ButtonGroup — renders group of buttons\n',
			});
			const missing = await findComponentsWithoutStory(packages);
			assert.deepEqual(missing, [compPath]);
		});

		it('invalid JSON package.json -> rejects with path in message (negative)', async () => {
			const packages = join(tempRoot, 'fixture-invalid-json');
			const pkgJsonPath = join(packages, 'demo/package.json');
			await writeTree(packages, {
				'demo/package.json': '{ invalid json: true ',
				'demo/src/Button.svelte': '<button></button>',
			});
			await assert.rejects(
				() => findComponentsWithoutStory(packages),
				(err) => {
					assert.ok(err instanceof Error);
					assert.ok(
						err.message.includes(pkgJsonPath),
						`Expected error message to include path ${pkgJsonPath}, got: ${err.message}`,
					);
					assert.ok(err.cause, 'Expected error to have a cause');
					return true;
				},
			);
		});

		it('.stories.svelte itself not counted as a component needing a story', async () => {
			const packages = join(tempRoot, 'fixture-only-stories');
			await writeTree(packages, {
				'demo/package.json': JSON.stringify({ name: '@fixture/demo' }),
				'demo/src/Standalone.stories.svelte': '<script module></script>',
			});
			const missing = await findComponentsWithoutStory(packages);
			assert.deepEqual(missing, []);
		});

		it('skips unexported components in src/internal/ but checks exported ones', async () => {
			const packages = join(tempRoot, 'fixture-internal');
			const exportedComp = join(packages, 'demo/src/internal/Exported.svelte');
			await writeTree(packages, {
				'demo/package.json': JSON.stringify({
					name: '@fixture/demo',
					exports: { './internal/exported': './src/internal/Exported.svelte' },
				}),
				'demo/src/internal/Unexported.svelte': '<div>Internal</div>',
				'demo/src/internal/Exported.svelte': '<div>Public Internal</div>',
			});
			const missing = await findComponentsWithoutStory(packages);
			assert.deepEqual(missing, [exportedComp]);
		});

		it('repository self-test returns []', async () => {
			const missing = await findComponentsWithoutStory(join(root, 'packages'));
			assert.deepEqual(missing, []);
		});
	});
});
