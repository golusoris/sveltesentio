import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { gzipSync } from 'node:zlib';
import {
	archiveGaps,
	LICENSOR,
	main,
	readArchive,
	readExpected,
	scanArchives,
	TYPESCRIPT_PEER,
} from './check-package-archives.mjs';

const URL_OF_SOURCE = 'git+https://github.com/example/workspace.git';
const LICENCE_TEXT = Buffer.from('EXAMPLE PUBLIC LICENCE\n\nThe full text.\n');
const NOTICE = `EUPL-1.2 © ${LICENSOR}. Releases up to and including 0.1.0 are MIT.`;

/** One tar entry: a 512-byte header and the body padded to the block size. */
function entry(name, body, type = '0') {
	const header = Buffer.alloc(512);
	header.write(name, 0, 100, 'utf8');
	header.write(body.length.toString(8).padStart(11, '0'), 124, 12, 'utf8');
	header.write(type, 156, 1, 'utf8');
	header.write('ustar', 257, 6, 'utf8');
	const padded = Buffer.alloc(Math.ceil(body.length / 512) * 512);
	body.copy(padded);
	return Buffer.concat([header, padded]);
}

/** A gzipped tar archive holding `files` (path to string or bytes). */
function archive(files) {
	const entries = Object.entries(files).map(([name, body]) => entry(name, Buffer.from(body)));
	return gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]));
}

const manifest = (overrides = {}) => ({
	name: '@example/alpha',
	version: '0.2.0',
	license: 'EUPL-1.2',
	repository: { directory: 'packages/alpha', type: 'git', url: URL_OF_SOURCE },
	engines: { node: '>=24' },
	peerDependencies: { typescript: '>=5.5 <7' },
	...overrides,
});

/** The files of a complete archive, with `overrides` replacing or removing some. */
function packageFiles(overrides = {}, manifestOverrides = {}) {
	const files = {
		'package/package.json': JSON.stringify(manifest(manifestOverrides)),
		'package/LICENSE': LICENCE_TEXT,
		'package/README.md': `# alpha\n\n## License\n\n${NOTICE}\n`,
		'package/src/index.ts': 'export const alpha = 1;\n',
		...overrides,
	};
	return Object.fromEntries(Object.entries(files).filter(([, body]) => body !== undefined));
}

const expected = {
	licence: LICENCE_TEXT,
	license: 'EUPL-1.2',
	url: URL_OF_SOURCE,
	node: '>=24',
	typescript: '>=5.5 <7',
	directories: new Map([['@example/alpha', 'packages/alpha']]),
};

const gapsOf = (overrides, manifestOverrides) =>
	archiveGaps(readArchive(archive(packageFiles(overrides, manifestOverrides))), expected).gaps;

describe('check-package-archives', () => {
	let tempRoot;

	before(async () => {
		tempRoot = await mkdtemp(join(tmpdir(), 'cpa-test-'));
	});

	after(async () => {
		if (tempRoot) {
			await rm(tempRoot, { recursive: true, force: true });
		}
	});

	/** A workspace on disk with one published package folder named `alpha`. */
	const workspace = async (name, rootManifest) => {
		const dir = join(tempRoot, name);
		await mkdir(join(dir, 'packages', 'alpha'), { recursive: true });
		await writeFile(join(dir, 'package.json'), JSON.stringify(rootManifest));
		await writeFile(join(dir, 'LICENSE'), LICENCE_TEXT);
		await writeFile(join(dir, 'packages', 'alpha', 'package.json'), JSON.stringify(manifest()));
		return dir;
	};

	const rootManifest = {
		license: 'EUPL-1.2',
		repository: { type: 'git', url: URL_OF_SOURCE },
		engines: { node: '>=24' },
	};

	/** Stands in for the packer: writes the given archives into the destination. */
	const packer = (archives) => async (_dir, destination) => {
		for (const [name, bytes] of Object.entries(archives)) {
			await writeFile(join(destination, name), bytes);
		}
	};

	describe('readArchive', () => {
		it('reads the regular files with their bytes', () => {
			const files = readArchive(archive({ 'package/a.txt': 'one', 'package/b.txt': 'two\n' }));
			assert.deepEqual([...files.keys()], ['package/a.txt', 'package/b.txt']);
			assert.equal(files.get('package/b.txt').toString('utf8'), 'two\n');
		});

		it('reads an empty archive and an empty file', () => {
			assert.equal(readArchive(archive({})).size, 0);
			assert.equal(readArchive(archive({ 'package/empty': '' })).get('package/empty').length, 0);
		});

		it('reads a file whose size is a whole number of blocks', () => {
			const files = readArchive(archive({ 'package/block': 'x'.repeat(512), 'package/next': 'y' }));
			assert.equal(files.get('package/block').length, 512);
			assert.equal(files.get('package/next').toString('utf8'), 'y');
		});

		it('leaves out an entry that is not a regular file', () => {
			const tar = Buffer.concat([entry('package/dir/', Buffer.alloc(0), '5'), Buffer.alloc(1024)]);
			assert.equal(readArchive(gzipSync(tar)).size, 0);
		});

		it('joins the prefix field to the name', () => {
			const withPrefix = entry('index.ts', Buffer.from('x'));
			withPrefix.write('package/src', 345, 155, 'utf8');
			const files = readArchive(gzipSync(Buffer.concat([withPrefix, Buffer.alloc(1024)])));
			assert.deepEqual([...files.keys()], ['package/src/index.ts']);
		});

		it('refuses bytes that are not gzip', () => {
			assert.throws(() => readArchive(Buffer.from('not an archive')));
		});

		it('refuses an entry whose size runs past the end', () => {
			const truncated = entry('package/a.txt', Buffer.from('abc')).subarray(0, 512);
			assert.throws(() => readArchive(gzipSync(truncated)), /no readable size/);
		});
	});

	describe('archiveGaps', () => {
		it('accepts a complete archive', () => {
			assert.deepEqual(gapsOf(), []);
		});

		it('reports a missing licence file', () => {
			assert.deepEqual(gapsOf({ 'package/LICENSE': undefined }), [
				'no LICENSE file in the archive',
			]);
		});

		it('reports a licence file that differs from the root one by a byte', () => {
			const altered = Buffer.concat([LICENCE_TEXT, Buffer.from('\n')]);
			assert.deepEqual(gapsOf({ 'package/LICENSE': altered }), [
				'LICENSE differs from the root LICENSE',
			]);
		});

		it('reports a licence identifier other than the root one', () => {
			assert.deepEqual(gapsOf({}, { license: 'MIT' }), ['license is "MIT", expected "EUPL-1.2"']);
		});

		it('reports a missing repository field and the short form', () => {
			assert.deepEqual(gapsOf({}, { repository: undefined }), [
				'package.json has no repository object',
			]);
			assert.deepEqual(gapsOf({}, { repository: 'example/workspace' }), [
				'package.json has no repository object',
			]);
		});

		it('compares the address by case', () => {
			const url = URL_OF_SOURCE.replace('example', 'Example');
			const gaps = gapsOf({}, { repository: { ...manifest().repository, url } });
			assert.deepEqual(gaps, [`repository.url is "${url}", expected "${URL_OF_SOURCE}"`]);
		});

		it('reports a directory that is not the package folder, and a missing type', () => {
			const gaps = gapsOf({}, { repository: { directory: 'packages/beta', url: URL_OF_SOURCE } });
			assert.deepEqual(gaps, [
				'repository.type is not "git"',
				'repository.directory is "packages/beta", expected "packages/alpha"',
			]);
		});

		it('reports missing engines', () => {
			assert.deepEqual(gapsOf({}, { engines: undefined }), [
				'engines.node is undefined, expected ">=24"',
			]);
		});

		it('reports engines without node', () => {
			assert.deepEqual(gapsOf({}, { engines: {} }), ['engines.node is undefined, expected ">=24"']);
		});

		it('reports a different node range', () => {
			assert.deepEqual(gapsOf({}, { engines: { node: '>=22' } }), [
				'engines.node is ">=22", expected ">=24"',
			]);
		});

		it('reports a whitespace variant in node range', () => {
			assert.deepEqual(gapsOf({}, { engines: { node: '>= 24' } }), [
				'engines.node is ">= 24", expected ">=24"',
			]);
		});

		it('reports a missing typescript peer', () => {
			const gap = 'peerDependencies.typescript is undefined, expected ">=5.5 <7"';
			assert.deepEqual(gapsOf({}, { peerDependencies: undefined }), [gap]);
			assert.deepEqual(gapsOf({}, { peerDependencies: { svelte: '>=5.0.0' } }), [gap]);
		});

		it('reports a different typescript range, including the old upper bound', () => {
			assert.deepEqual(gapsOf({}, { peerDependencies: { typescript: '>=5.5 <8' } }), [
				'peerDependencies.typescript is ">=5.5 <8", expected ">=5.5 <7"',
			]);
			assert.deepEqual(gapsOf({}, { peerDependencies: { typescript: '>=5.5' } }), [
				'peerDependencies.typescript is ">=5.5", expected ">=5.5 <7"',
			]);
		});

		it('reports a typescript peer marked optional and accepts other optional peers', () => {
			const meta = (name) => ({ peerDependenciesMeta: { [name]: { optional: true } } });
			assert.deepEqual(gapsOf({}, meta('typescript')), [
				'peerDependenciesMeta marks typescript optional',
			]);
			assert.deepEqual(gapsOf({}, meta('openapi-typescript')), []);
		});

		it('reports a readme without the copyright line, and no readme at all', () => {
			const none = 'README.md has 0 lines starting "EUPL-1.2 © lusoris"';
			assert.deepEqual(gapsOf({ 'package/README.md': '# alpha\n\nEUPL-1.2.\n' }), [none]);
			assert.deepEqual(gapsOf({ 'package/README.md': undefined }), [none]);
		});

		it('accepts the copyright line with a carriage return and refuses it twice', () => {
			assert.deepEqual(gapsOf({ 'package/README.md': `# alpha\r\n\r\n${NOTICE}\r\n` }), []);
			assert.deepEqual(gapsOf({ 'package/README.md': `${NOTICE}\n\n${NOTICE}\n` }), [
				'README.md has 2 lines starting "EUPL-1.2 © lusoris"',
			]);
		});

		it('collects every gap of one archive', () => {
			const gaps = gapsOf(
				{ 'package/LICENSE': undefined, 'package/README.md': '' },
				{ repository: undefined },
			);
			assert.equal(gaps.length, 3);
		});

		it('skips a private package and reports an archive without a manifest', () => {
			const lacking = { 'package/LICENSE': undefined, 'package/README.md': undefined };
			const skipped = archiveGaps(
				readArchive(archive(packageFiles(lacking, { private: true, repository: undefined }))),
				expected,
			);
			assert.deepEqual(skipped, { name: '@example/alpha', published: false, gaps: [] });

			const bare = archiveGaps(readArchive(archive({ 'package/LICENSE': LICENCE_TEXT })), expected);
			assert.deepEqual(bare.gaps, ['no package.json']);
		});
	});

	describe('readExpected', () => {
		it('reads the licence, the address and the package folders', async () => {
			const read = await readExpected(await workspace('expected', rootManifest));
			assert.equal(read.url, URL_OF_SOURCE);
			assert.equal(read.license, 'EUPL-1.2');
			assert.equal(read.node, '>=24');
			assert.equal(read.typescript, TYPESCRIPT_PEER);
			assert.ok(read.licence.equals(LICENCE_TEXT));
			assert.deepEqual([...read.directories], [['@example/alpha', 'packages/alpha']]);
		});

		it('refuses a root manifest without the address', async () => {
			const dir = await workspace('no-address', {
				license: 'EUPL-1.2',
				engines: { node: '>=24' },
			});
			await assert.rejects(
				readExpected(dir),
				/needs a license, a repository\.url and an engines\.node/,
			);
		});

		it('refuses a root manifest without engines.node', async () => {
			const dir = await workspace('no-node', {
				license: 'EUPL-1.2',
				repository: { type: 'git', url: URL_OF_SOURCE },
			});
			await assert.rejects(
				readExpected(dir),
				/needs a license, a repository\.url and an engines\.node/,
			);
		});
	});

	describe('main', () => {
		it('returns 0 when every published archive is complete', async () => {
			const dir = await workspace('complete', rootManifest);
			const pack = packer({
				'alpha-0.2.0.tgz': archive(packageFiles()),
				'app-0.0.0.tgz': archive({
					'package/package.json': JSON.stringify({ name: '@example/app', private: true }),
				}),
			});
			assert.equal(await main(dir, pack), 0);
		});

		it('returns 1 when an archive lacks the repository field', async () => {
			const dir = await workspace('planted', rootManifest);
			const planted = archive(packageFiles({}, { repository: undefined }));
			assert.equal(await main(dir, packer({ 'alpha-0.2.0.tgz': planted })), 1);
		});

		it('returns 1 when the packer wrote nothing', async () => {
			const dir = await workspace('nothing', rootManifest);
			assert.equal(await main(dir, packer({})), 1);
		});

		it('returns 1 when a package folder has no archive', async () => {
			const dir = await workspace('unpacked', rootManifest);
			const other = archive(packageFiles({}, { name: '@example/other' }));
			assert.equal(await main(dir, packer({ 'other-0.2.0.tgz': other })), 1);
		});

		it('passes a packer failure on', async () => {
			const dir = await workspace('failing', rootManifest);
			const failing = async () => {
				throw new Error('pack failed');
			};
			await assert.rejects(main(dir, failing), /pack failed/);
		});
	});

	describe('scanArchives', () => {
		it('reads only archives and sorts them', async () => {
			const folder = join(tempRoot, 'scan');
			await mkdir(folder);
			await writeFile(join(folder, 'b.tgz'), archive(packageFiles()));
			await writeFile(join(folder, 'a.tgz'), archive(packageFiles()));
			await writeFile(join(folder, 'notes.txt'), 'not an archive');
			const results = await scanArchives(folder, expected);
			assert.deepEqual(
				results.map((result) => result.archive),
				['a.tgz', 'b.tgz'],
			);
		});
	});

	// Packs this workspace with pnpm, as the release workflow's publish does.
	it('finds nothing missing in the archives of this repository', { timeout: 300_000 }, async () => {
		assert.equal(await main(), 0);
	});
});
