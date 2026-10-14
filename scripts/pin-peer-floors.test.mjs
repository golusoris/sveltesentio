import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
	collectRanges,
	FLOORED_PEERS,
	installedGaps,
	lowestRelease,
	main,
	withOverrides,
} from './pin-peer-floors.mjs';

const WORKSPACE = [
	'packages:',
	"  - 'packages/*'",
	'overrides:',
	"  '@sveltejs/kit@2>cookie': '>=0.7.0 <1'",
	'',
].join('\n');

describe('collectRanges', () => {
	it('reads one range per peer from every manifest that declares it', () => {
		const { ranges, conflicts } = collectRanges([
			{ name: 'a', peerDependencies: { svelte: '>=5.56.4', typescript: '>=5.5 <7' } },
			{ name: 'b', peerDependencies: { svelte: '>=5.56.4', zod: '^4' } },
		]);
		assert.deepEqual(conflicts, []);
		assert.equal(ranges.get('svelte').range, '>=5.56.4');
		assert.equal(ranges.get('typescript').range, '>=5.5 <7');
		assert.equal(ranges.has('zod'), false);
	});

	it('reports two packages that declare one peer with two ranges', () => {
		const { conflicts } = collectRanges([
			{ name: 'a', peerDependencies: { svelte: '>=5.56.4' } },
			{ name: 'b', peerDependencies: { svelte: '>=5.0.0' } },
		]);
		assert.deepEqual(conflicts, ['svelte: a declares ">=5.56.4", b declares ">=5.0.0"']);
	});

	it('accepts manifests without peers and floors exactly the four peers', () => {
		const { ranges, conflicts } = collectRanges([{ name: 'a' }]);
		assert.equal(ranges.size, 0);
		assert.deepEqual(conflicts, []);
		assert.deepEqual([...FLOORED_PEERS], ['svelte', '@sveltejs/kit', 'vite', 'typescript']);
	});
});

describe('lowestRelease', () => {
	it('picks the lowest release by number, not by text', () => {
		assert.equal(lowestRelease(['5.10.0', '5.9.3', '5.56.4']), '5.9.3');
		assert.equal(lowestRelease(['6.0.3', '5.5.2', '5.5.10']), '5.5.2');
	});

	it('refuses an empty list, a prerelease and a tag', () => {
		assert.throws(() => lowestRelease([]), /matches no release/);
		assert.throws(
			() => lowestRelease(['5.57.0', '5.57.0-next.1']),
			/not a plain release: 5.57.0-next.1/,
		);
		assert.throws(() => lowestRelease(['latest']), /not a plain release/);
	});

	it('accepts the single string npm prints when one release matches', () => {
		assert.equal(lowestRelease('8.0.0'), '8.0.0');
	});
});

describe('withOverrides', () => {
	it('adds one override per floor under the overrides line', () => {
		const text = withOverrides(
			WORKSPACE,
			new Map([
				['svelte', '5.56.4'],
				['@sveltejs/kit', '2.53.0'],
			]),
		);
		assert.match(
			text,
			/overrides:\n {2}'svelte': 5\.56\.4\n {2}'@sveltejs\/kit': 2\.53\.0\n {2}'@sveltejs\/kit@2>cookie'/,
		);
	});

	it('refuses a file that already overrides a floored peer', () => {
		const pinned = WORKSPACE.replace('overrides:\n', 'overrides:\n  svelte: 5.0.0\n');
		assert.throws(
			() => withOverrides(pinned, new Map([['svelte', '5.56.4']])),
			/already overridden: svelte: 5.0.0/,
		);
	});

	it('refuses a file with no overrides line or with two', () => {
		assert.throws(() => withOverrides('packages: []\n', new Map()), /found 0/);
		assert.throws(() => withOverrides(`${WORKSPACE}overrides:\n`, new Map()), /found 2/);
	});

	it('keeps a scoped override of a floored peer apart from the peer itself', () => {
		const text = withOverrides(WORKSPACE, new Map([['@sveltejs/kit', '2.53.0']]));
		assert.equal(text.split('\n').filter((line) => line.includes('@sveltejs/kit')).length, 2);
	});
});

describe('installedGaps', () => {
	const floors = new Map([['svelte', '5.56.4']]);

	it('returns nothing when every package has its floor', () => {
		assert.deepEqual(installedGaps([{ name: 'a', peer: 'svelte', version: '5.56.4' }], floors), []);
	});

	it('names a package above the floor and one with nothing installed', () => {
		assert.deepEqual(
			installedGaps(
				[
					{ name: 'a', peer: 'svelte', version: '5.57.2' },
					{ name: 'b', peer: 'svelte', version: undefined },
				],
				floors,
			),
			['a: svelte 5.57.2, floor 5.56.4', 'b: svelte not installed, floor 5.56.4'],
		);
	});

	it('ignores a peer that has no floor', () => {
		assert.deepEqual(installedGaps([{ name: 'a', peer: 'zod', version: '4.0.0' }], floors), []);
	});
});

describe('main', () => {
	let dir;
	const view = async (peer) =>
		({ svelte: ['5.56.5', '5.56.4'], typescript: ['5.5.2', '6.0.3'] })[peer];

	async function pkg(name, manifest) {
		await mkdir(join(dir, 'packages', name), { recursive: true });
		await writeFile(join(dir, 'packages', name, 'package.json'), JSON.stringify(manifest));
	}

	async function installed(base, peer, version) {
		await mkdir(join(base, 'node_modules', peer), { recursive: true });
		await writeFile(join(base, 'node_modules', peer, 'package.json'), JSON.stringify({ version }));
	}

	before(async () => {
		dir = await mkdtemp(join(tmpdir(), 'peer-floors-'));
		await writeFile(join(dir, 'pnpm-workspace.yaml'), WORKSPACE);
		await pkg('a', { name: 'a', peerDependencies: { svelte: '>=5.56.4', typescript: '>=5.5 <7' } });
		await pkg('hidden', { name: 'hidden', private: true, peerDependencies: { svelte: '>=5.0.0' } });
	});

	after(() => rm(dir, { recursive: true, force: true }));

	it('writes the floors of published packages and skips a private one', async () => {
		assert.equal(await main([], dir, view), 0);
		const text = await readFile(join(dir, 'pnpm-workspace.yaml'), 'utf8');
		assert.match(text, /'svelte': 5\.56\.4\n {2}'typescript': 5\.5\.2/);
	});

	it('fails verify while an install misses a floor, passes once both hold', async () => {
		await installed(join(dir, 'packages', 'a'), 'svelte', '5.56.4');
		await installed(dir, 'typescript', '6.0.3');
		assert.equal(await main(['--verify'], dir, view), 1);
		await installed(dir, 'typescript', '5.5.2');
		assert.equal(await main(['--verify'], dir, view), 0);
	});
});
