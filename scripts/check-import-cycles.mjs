#!/usr/bin/env node
// Enforces HISS-01 acyclic module and package graphs across packages/*/src.
// Uses dependency-cruiser for AST-accurate module cycle detection across .ts,
// .svelte.ts and .svelte files, and keeps a DFS check for cross-package cycles.
import { cruise } from 'dependency-cruiser';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const packagesDir = join(root, 'packages');

const SOURCE_EXT = ['.ts', '.svelte.ts', '.svelte'];

// Upper bound on directory entries one `walk` visits (HISS-02).
const WALK_LIMIT = 100_000;
const CRUISE_TIMEOUT_MS = 60_000;

export async function walk(dir, out = []) {
	const stack = [{ isDir: true, path: dir }];

	for (let step = 0; step < WALK_LIMIT; step += 1) {
		const item = stack.pop();
		if (item === undefined) break;

		if (!item.isDir) {
			out.push(item.path);
			continue;
		}

		let entries;
		try {
			entries = await readdir(item.path, { withFileTypes: true });
		} catch (error) {
			if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
				continue;
			}
			throw error;
		}

		for (let i = entries.length - 1; i >= 0; i -= 1) {
			const entry = entries[i];
			const full = join(item.path, entry.name);
			if (entry.isDirectory()) {
				stack.push({ isDir: true, path: full });
			} else if (SOURCE_EXT.some((e) => entry.name.endsWith(e))) {
				stack.push({ isDir: false, path: full });
			}
		}
	}

	if (stack.length > 0) {
		throw new Error(`walk exceeded limit of ${WALK_LIMIT} steps`);
	}
	return out;
}

/** Static import/export specifiers. Ignores type-only imports, which erase. */
const PKG_SPECIFIER = /(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^;'"\n]*?from\s*['"]([^'"]+)['"]/g;
/** Bare side-effect imports: `import './register.js'`. */
const PKG_BARE = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
/** Dynamic imports with a literal specifier: `await import('./peer.js')`. */
const PKG_DYNAMIC = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

export function packageSpecifiersOf(source) {
	const found = new Set();
	for (const re of [PKG_SPECIFIER, PKG_BARE, PKG_DYNAMIC]) {
		re.lastIndex = 0;
		let match;
		while ((match = re.exec(source)) !== null) {
			if (match[1].startsWith('@sveltesentio/')) found.add(match[1]);
		}
	}
	return [...found];
}

const WHITE = 0;
const GREY = 1;
const BLACK = 2;

/**
 * Depth-first search from `rootNode` with an explicit frame stack (HISS-01).
 * `limit` bounds the loop (HISS-02): a search looks at each edge once and leaves
 * each node once, so `findCycle` passes nodes + edges + 1.
 */
function dfsFromRoot(rootNode, graph, colour, path, limit) {
	colour.set(rootNode, GREY);
	path.push(rootNode);
	const frames = [{ node: rootNode, neighbours: [...(graph.get(rootNode) ?? [])], edgeIndex: 0 }];

	for (let step = 0; step < limit; step += 1) {
		const frame = frames.at(-1);
		if (frame === undefined) return undefined;
		if (frame.edgeIndex === frame.neighbours.length) {
			frames.pop();
			path.pop();
			colour.set(frame.node, BLACK);
			continue;
		}
		const next = frame.neighbours[frame.edgeIndex];
		frame.edgeIndex += 1;
		if (colour.get(next) === GREY) return [...path.slice(path.indexOf(next)), next];
		if (colour.get(next) === WHITE) {
			colour.set(next, GREY);
			path.push(next);
			frames.push({ node: next, neighbours: [...(graph.get(next) ?? [])], edgeIndex: 0 });
		}
	}
	throw new Error(`findCycle exceeded its bound of ${limit} steps`);
}

/**
 * Depth-first cycle search; returns the first cycle found as a node list.
 * `graph` maps a node to an iterable of its targets (a Set here, an array in tests).
 */
export function findCycle(graph) {
	const colour = new Map();
	let edges = 0;
	for (const [node, targets] of graph) {
		colour.set(node, WHITE);
		edges += [...targets].length;
	}
	const limit = graph.size + edges + 1;
	const path = [];

	for (const r of graph.keys()) {
		if (colour.get(r) !== WHITE) continue;
		const cycle = dfsFromRoot(r, graph, colour, path, limit);
		if (cycle) return cycle;
	}
	return undefined;
}

/** Walks every package's src and builds the @sveltesentio/* package graph. */
async function collectSources(pkgDir, packages) {
	const sourceFiles = [];
	const packageGraph = new Map(packages.map((p) => [`@sveltesentio/${p}`, new Set()]));

	for (const pkg of packages) {
		const self = `@sveltesentio/${pkg}`;
		const files = await walk(join(pkgDir, pkg, 'src'));
		for (const file of files) {
			sourceFiles.push(file);
			const source = await readFile(file, 'utf8');
			for (const spec of packageSpecifiersOf(source)) {
				const dep = spec.split('/').slice(0, 2).join('/');
				if (dep !== self && packageGraph.has(dep)) {
					packageGraph.get(self)?.add(dep);
				}
			}
		}
	}
	return { sourceFiles, packageGraph };
}

const CRUISE_OPTIONS = Object.freeze({
	validate: true,
	ruleSet: {
		forbidden: [
			{
				name: 'no-circular',
				severity: 'error',
				from: {},
				to: { circular: true, pathNot: '^node_modules' },
			},
		],
	},
	doNotFollow: { path: 'node_modules' },
	outputType: 'json',
});

/** Runs dependency-cruiser over `sourceFiles` and rejects after `timeoutMs`. */
export async function cruiseWithTimeout(sourceFiles, timeoutMs, options = CRUISE_OPTIONS) {
	let timer;
	const timeoutPromise = new Promise((_, reject) => {
		timer = setTimeout(() => {
			reject(new Error(`dependency-cruiser timed out after ${timeoutMs}ms`));
		}, timeoutMs);
		timer.unref?.();
	});

	let result;
	try {
		result = await Promise.race([cruise(sourceFiles, options), timeoutPromise]);
	} finally {
		clearTimeout(timer);
	}
	return typeof result.output === 'string' ? JSON.parse(result.output) : result.output;
}

export async function checkImportCycles(
	pkgDir = packagesDir,
	{ timeoutMs = CRUISE_TIMEOUT_MS } = {},
) {
	const packages = (await readdir(pkgDir, { withFileTypes: true }))
		.filter((e) => e.isDirectory())
		.map((e) => e.name);

	const { sourceFiles, packageGraph } = await collectSources(pkgDir, packages);
	if (sourceFiles.length === 0) {
		throw new Error('Zero source files found to analyse (failing closed).');
	}

	const data = await cruiseWithTimeout(sourceFiles, timeoutMs);
	const cruisedModules = new Set(data.modules.map((m) => resolve(m.source)));
	const analysedCount = sourceFiles.filter((f) => cruisedModules.has(resolve(f))).length;

	if (analysedCount === 0 || analysedCount < sourceFiles.length) {
		throw new Error(
			`dependency-cruiser analysed ${analysedCount} modules, fewer than ${sourceFiles.length} source files found (failing closed).`,
		);
	}

	const violations = data.summary.violations ?? [];
	const moduleCycles = violations
		.filter((v) => v.rule?.name === 'no-circular' || v.type === 'cycle')
		.map((v) => [v.from, ...v.cycle.map((c) => c.name)].map((f) => resolve(f)));

	return {
		packages,
		sourceFiles,
		analysedCount,
		moduleCycles,
		packageGraph,
		packageCycle: findCycle(packageGraph),
	};
}

export async function main() {
	let res;
	try {
		res = await checkImportCycles(packagesDir);
	} catch (err) {
		console.error(`HISS-01: ${err.message}\n`);
		process.exit(1);
	}

	const { packages, analysedCount, moduleCycles, packageCycle } = res;
	const problems = [];

	for (const cycle of moduleCycles) {
		problems.push(
			'Module import cycle:\n  ' + cycle.map((f) => relative(root, f)).join('\n    -> '),
		);
	}
	if (packageCycle) {
		problems.push('Package import cycle:\n  ' + packageCycle.join('\n    -> '));
	}

	if (problems.length > 0) {
		console.error('HISS-01: the import graph is not acyclic.\n');
		for (const problem of problems) console.error(problem + '\n');
		process.exit(1);
	}

	console.log(
		`OK: no import cycles across ${analysedCount} modules in ${packages.length} packages.`,
	);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main();
}
