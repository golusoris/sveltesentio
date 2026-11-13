import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IO_TIMEOUT_MS } from './check-platform-legs.mjs';

export const ownRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
export const validWorkflow = [
	'on:',
	'  push:',
	'    branches: [main]',
	'  pull_request:',
	'    branches: [main]',
	'jobs:',
	'  lint:',
	'    runs-on: ubuntu-26.04',
	'    steps:',
	'      - run: echo lint',
	'  ci-gate:',
	'    name: CI Gate',
	'    if: always()',
	'    needs: [lint]',
	'    runs-on: ubuntu-26.04',
	'    steps:',
	'      - env:',
	'          NEEDS: ${{ toJSON(needs) }}',
	'          EVENT_NAME: ${{ github.event_name }}',
	'        run: node scripts/ci-gate.mjs',
].join('\n');
let tempRoot;

export async function createTempRoot() {
	tempRoot = await mkdtemp(join(tmpdir(), 'ruleset-test-'));
}

export async function removeTempRoot() {
	if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
}

export function makeRuleset({ review = {}, ...overrides } = {}) {
	return {
		enforcement: 'active',
		bypass_actors: [{ actor_type: 'RepositoryRole', actor_id: 5, bypass_mode: 'pull_request' }],
		rules: [
			{
				type: 'pull_request',
				parameters: {
					required_approving_review_count: 0,
					require_code_owner_review: false,
					require_last_push_approval: false,
					...review,
				},
			},
			{
				type: 'required_status_checks',
				parameters: { required_status_checks: [{ context: 'CI Gate' }] },
			},
		],
		target: 'branch',
		conditions: { ref_name: { include: ['refs/heads/main'], exclude: [] } },
		...overrides,
	};
}

async function writeFixtureFile(root, relPath, source) {
	const path = join(root, relPath);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, source, {
		encoding: 'utf8',
		signal: AbortSignal.timeout(IO_TIMEOUT_MS),
	});
}

export async function fixture({
	ruleset = makeRuleset(),
	source = JSON.stringify(ruleset),
	owners = { '.github/CODEOWNERS': '* @owner' },
	workflow = validWorkflow,
} = {}) {
	const root = await mkdtemp(join(tempRoot, 'case-'));
	if (source !== null) await writeFixtureFile(root, '.github/rulesets/main.json', source);
	if (workflow !== null) await writeFixtureFile(root, '.github/workflows/ci.yml', workflow);
	const entries = Object.entries(owners);
	for (let i = 0; i < entries.length; i++) {
		const [path, content] = entries[i];
		await writeFixtureFile(root, path, content);
	}
	return root;
}
