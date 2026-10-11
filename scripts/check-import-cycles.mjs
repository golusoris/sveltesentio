#!/usr/bin/env node
// Fails if the import graph inside packages/*/src contains a cycle.
//
// HISS-01 requires the call graph to be a DAG, and nothing in this repository
// measured that: praetor's scanner does not read .ts, and no ESLint cycle rule
// is configured — eslint-plugin-import would be a new dependency, which hard
// rule 2 puts behind a D-row. A script needs none, and follows the precedent
// already set by check-export-targets.mjs.
//
// Scope is deliberately two graphs, because they fail differently:
//   - within a package, a cycle is a design smell that still bundles;
//   - across packages, a cycle breaks the opt-in module story outright, since a
//     consumer installing one package would transitively require the other.
//
// Resolution is deliberately syntactic. It reads static `import`/`export ... from`
// specifiers plus dynamic `import()` with a literal specifier, and resolves the
// relative ones against the filesystem; it does not run the TypeScript resolver.
//
// A dynamic import forms a real cycle: `await import('./peer.js')` is an edge a
// bundler follows, and the fact that it resolves at runtime rather than parse
// time does not make the graph acyclic. It is read here for that reason.
//
// Two things stay out of reach, and are recorded in .config/hiss/coverage.yaml
// rather than implied to be covered:
//   - a computed specifier — `import(name)` — cannot be followed syntactically;
//   - path aliases would need the TypeScript resolver. No package under
//     packages/*/ declares `compilerOptions.paths`, and no package source
//     imports through an alias, so this is currently vacuous rather than a
//     silent hole.
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const packagesDir = join(root, 'packages');

/** Static import/export specifiers. Ignores type-only imports, which erase. */
const SPECIFIER = /(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^;'"]*?from\s*['"]([^'"]+)['"]/g;
/** Bare side-effect imports: `import './register.js'`. */
const BARE = /(?:^|\n)\s*import\s*['"](\.[^'"]+)['"]/g;
/**
 * Dynamic imports with a literal specifier: `await import('./peer.js')`.
 *
 * `\s` matches newlines, so a call broken across lines to satisfy the line-length
 * limit is still read. `import.meta.glob(...)` does not match, because the
 * parenthesis there follows a property access rather than `import`.
 */
const DYNAMIC = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

const SOURCE_EXT = ['.ts', '.svelte.ts', '.svelte'];

// Upper bound on directory entries one `walk` visits (HISS-02). The source trees
// of all packages hold a few hundred entries; the bound stops a mis-pointed root,
// and running into it is an error, not a truncated result.
const WALK_LIMIT = 100_000;

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

/** Resolves a relative specifier to a real file, trying the extensions TS rewrites. */
export async function resolveRelative(fromFile, spec) {
	const base = resolve(dirname(fromFile), spec);
	const candidates = [
		base,
		base.replace(/\.js$/, '.ts'),
		base.replace(/\.js$/, '.svelte.ts'),
		`${base}.ts`,
		join(base, 'index.ts'),
	];
	for (let i = 0; i < candidates.length; i += 1) {
		const candidate = candidates[i];
		try {
			if ((await stat(candidate)).isFile()) return candidate;
		} catch (error) {
			if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
				/* try the next shape */
				continue;
			}
			throw error;
		}
	}
	return undefined;
}

export function specifiersOf(source) {
	const found = new Set();
	for (const re of [SPECIFIER, BARE, DYNAMIC]) {
		re.lastIndex = 0;
		let match;
		while ((match = re.exec(source)) !== null) found.add(match[1]);
	}
	return [...found];
}

const WHITE = 0;
const GREY = 1;
const BLACK = 2;

/**
 * One depth-first search from `root` with an explicit frame stack (HISS-01).
 * `limit` bounds the loop (HISS-02): a search looks at each edge once and leaves
 * each node once, so `findCycle` passes nodes + edges + 1.
 */
function dfsFromRoot(root, graph, colour, path, limit) {
	colour.set(root, GREY);
	path.push(root);
	const frames = [{ node: root, neighbours: [...(graph.get(root) ?? [])], edgeIndex: 0 }];

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

	for (const root of graph.keys()) {
		if (colour.get(root) !== WHITE) continue;
		const cycle = dfsFromRoot(root, graph, colour, path, limit);
		if (cycle) return cycle;
	}
	return undefined;
}

/** Builds the file and package dependency graphs. */
export async function buildGraphs(pkgDir = packagesDir) {
	const packages = (await readdir(pkgDir, { withFileTypes: true }))
		.filter((e) => e.isDirectory())
		.map((e) => e.name);

	const fileGraph = new Map();
	const packageGraph = new Map(packages.map((p) => [`@sveltesentio/${p}`, new Set()]));

	for (const pkg of packages) {
		for (const file of await walk(join(pkgDir, pkg, 'src'))) {
			const source = await readFile(file, 'utf8');
			const edges = new Set();
			for (const spec of specifiersOf(source)) {
				if (spec.startsWith('.')) {
					const target = await resolveRelative(file, spec);
					if (target) edges.add(target);
				} else if (spec.startsWith('@sveltesentio/')) {
					const dep = spec.split('/').slice(0, 2).join('/');
					const self = `@sveltesentio/${pkg}`;
					if (dep !== self) packageGraph.get(self)?.add(dep);
				}
			}
			fileGraph.set(file, edges);
		}
	}

	return { packages, fileGraph, packageGraph };
}

export async function main() {
	const { packages, fileGraph, packageGraph } = await buildGraphs(packagesDir);

	const problems = [];
	const fileCycle = findCycle(fileGraph);
	if (fileCycle) {
		problems.push(
			'Module import cycle:\n  ' + fileCycle.map((f) => relative(root, f)).join('\n    -> '),
		);
	}
	const packageCycle = findCycle(packageGraph);
	if (packageCycle) {
		problems.push('Package import cycle:\n  ' + packageCycle.join('\n    -> '));
	}

	if (problems.length > 0) {
		console.error('HISS-01: the import graph is not acyclic.\n');
		for (const problem of problems) console.error(problem + '\n');
		process.exit(1);
	}
	console.log(
		`OK: no import cycles across ${fileGraph.size} modules in ${packages.length} packages.`,
	);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main();
}
