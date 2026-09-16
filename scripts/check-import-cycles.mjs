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
import { fileURLToPath } from 'node:url';

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

async function walk(dir, out = []) {
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) await walk(full, out);
		else if (SOURCE_EXT.some((e) => entry.name.endsWith(e))) out.push(full);
	}
	return out;
}

/** Resolves a relative specifier to a real file, trying the extensions TS rewrites. */
async function resolveRelative(fromFile, spec) {
	const base = resolve(dirname(fromFile), spec);
	const candidates = [
		base,
		base.replace(/\.js$/, '.ts'),
		base.replace(/\.js$/, '.svelte.ts'),
		`${base}.ts`,
		join(base, 'index.ts'),
	];
	for (const candidate of candidates) {
		try {
			if ((await stat(candidate)).isFile()) return candidate;
		} catch {
			/* try the next shape */
		}
	}
	return undefined;
}

function specifiersOf(source) {
	const found = new Set();
	for (const re of [SPECIFIER, BARE, DYNAMIC]) {
		re.lastIndex = 0;
		let match;
		while ((match = re.exec(source)) !== null) found.add(match[1]);
	}
	return [...found];
}

/** Depth-first cycle search; returns the first cycle found as a node list. */
function findCycle(graph) {
	const WHITE = 0,
		GREY = 1,
		BLACK = 2;
	const colour = new Map([...graph.keys()].map((k) => [k, WHITE]));
	const stack = [];

	const visit = (node) => {
		colour.set(node, GREY);
		stack.push(node);
		for (const next of graph.get(node) ?? []) {
			if (colour.get(next) === GREY) return [...stack.slice(stack.indexOf(next)), next];
			if (colour.get(next) === WHITE) {
				const found = visit(next);
				if (found) return found;
			}
		}
		stack.pop();
		colour.set(node, BLACK);
		return undefined;
	};

	for (const node of graph.keys()) {
		if (colour.get(node) === WHITE) {
			const found = visit(node);
			if (found) return found;
		}
	}
	return undefined;
}

async function main() {
	const packages = (await readdir(packagesDir, { withFileTypes: true }))
		.filter((e) => e.isDirectory())
		.map((e) => e.name);

	const fileGraph = new Map();
	const packageGraph = new Map(packages.map((p) => [`@sveltesentio/${p}`, new Set()]));

	for (const pkg of packages) {
		for (const file of await walk(join(packagesDir, pkg, 'src'))) {
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

await main();
