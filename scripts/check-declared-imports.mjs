#!/usr/bin/env node
// Fails if a package imports a module its own package.json does not declare,
// or declares a @sveltesentio/* range that excludes the workspace version.
//
// pnpm hoists the root devDependencies, so an import a package never declares
// still resolves in this repository and breaks only for a consumer. The import
// half is dependency-cruiser's package.json-based dependency types, read from
// the package.json nearest to each file:
//   - undeclared: the module is in no dependency field of that manifest;
//   - dev-only: only in devDependencies, which a consumer never installs;
//     stories are excluded from the published files and may use them;
//   - unresolvable: the import resolves to no file at all. The compiled
//     `svelte/internal/*` imports a .svelte file gets are not in the source,
//     and a Vite `virtual:` module exists only inside the plugin that serves it.
//
// The range half reads every @sveltesentio/* entry of every manifest. pnpm
// publishes `workspace:*`, `workspace:^` and `workspace:~` as the current
// version; any other range must admit the version of the workspace package.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import semver from 'semver';
import { cruiseWithTimeout, walk } from './check-import-cycles.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const packagesDir = join(root, 'packages');

const CRUISE_TIMEOUT_MS = 60_000;
const DECLARED = ['npm', 'npm-peer', 'npm-optional'];
const DEPENDENCY_FIELDS = [
	'dependencies',
	'devDependencies',
	'peerDependencies',
	'optionalDependencies',
];
const WORKSPACE_ALIASES = new Set(['*', '^', '~']);

const CRUISE_OPTIONS = Object.freeze({
	validate: true,
	ruleSet: {
		forbidden: [
			{
				name: 'undeclared',
				severity: 'error',
				from: {},
				to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'], dependencyTypesNot: DECLARED },
			},
			{
				name: 'dev-only',
				severity: 'error',
				from: { pathNot: '\\.stories\\.svelte$' },
				to: { dependencyTypes: ['npm-dev'], dependencyTypesNot: DECLARED },
			},
			{
				name: 'unresolvable',
				severity: 'error',
				from: {},
				to: { couldNotResolve: true, pathNot: '^(svelte/internal/|virtual:)' },
			},
		],
	},
	doNotFollow: { path: 'node_modules' },
	tsPreCompilationDeps: true,
	enhancedResolveOptions: {
		exportsFields: ['exports'],
		conditionNames: ['svelte', 'import', 'types', 'default'],
		mainFields: ['svelte', 'module', 'main', 'types'],
	},
	outputType: 'json',
});

/** Returns why `range` excludes `version`, or undefined when it admits it. */
export function rangeProblem(range, version) {
	const spec = range.startsWith('workspace:') ? range.slice('workspace:'.length) : range;
	if (WORKSPACE_ALIASES.has(spec)) return undefined;
	if (semver.validRange(spec) === null) return `"${range}" is not a semver range`;
	if (!semver.satisfies(version, spec)) return `"${range}" excludes workspace version ${version}`;
	return undefined;
}

/** Lists @sveltesentio/* entries whose range excludes the workspace version. */
export function internalRangeViolations(manifests) {
	const versions = new Map(manifests.map((m) => [m.name, m.version]));
	const violations = [];
	for (const manifest of manifests) {
		for (const field of DEPENDENCY_FIELDS) {
			for (const [dep, range] of Object.entries(manifest[field] ?? {})) {
				if (!dep.startsWith('@sveltesentio/')) continue;
				const version = versions.get(dep);
				const problem =
					version === undefined ? 'names no workspace package' : rangeProblem(range, version);
				if (problem) violations.push(`${manifest.name} ${field} ${dep}: ${problem}`);
			}
		}
	}
	return violations;
}

/** Maps each violation to `rule: file -> module` with the import as written. */
function describeImports(data, violations) {
	const modules = new Map(data.modules.map((m) => [m.source, m]));
	return violations.map((v) => {
		const dependency = modules.get(v.from)?.dependencies.find((d) => d.resolved === v.to);
		return `${v.rule.name}: ${relative(root, resolve(v.from))} -> ${dependency?.module ?? v.to}`;
	});
}

async function readManifests(pkgDir, packages) {
	const manifests = [];
	for (const pkg of packages) {
		manifests.push(JSON.parse(await readFile(join(pkgDir, pkg, 'package.json'), 'utf8')));
	}
	return manifests;
}

export async function checkDeclaredImports(
	pkgDir = packagesDir,
	{ timeoutMs = CRUISE_TIMEOUT_MS } = {},
) {
	const packages = (await readdir(pkgDir, { withFileTypes: true }))
		.filter((e) => e.isDirectory())
		.map((e) => e.name);

	const sourceFiles = [];
	for (const pkg of packages) await walk(join(pkgDir, pkg, 'src'), sourceFiles);
	if (sourceFiles.length === 0) {
		throw new Error('Zero source files found to analyse (failing closed).');
	}

	const data = await cruiseWithTimeout(sourceFiles, timeoutMs, CRUISE_OPTIONS);
	const cruisedModules = new Set(data.modules.map((m) => resolve(m.source)));
	const analysedCount = sourceFiles.filter((f) => cruisedModules.has(resolve(f))).length;
	if (analysedCount < sourceFiles.length) {
		throw new Error(
			`dependency-cruiser analysed ${analysedCount} modules, fewer than ${sourceFiles.length} source files found (failing closed).`,
		);
	}

	return {
		packages,
		analysedCount,
		importViolations: describeImports(data, data.summary.violations ?? []),
		rangeViolations: internalRangeViolations(await readManifests(pkgDir, packages)),
	};
}

export async function main() {
	let res;
	try {
		res = await checkDeclaredImports(packagesDir);
	} catch (err) {
		console.error(`check-declared-imports: ${err.message}\n`);
		process.exit(1);
	}

	const problems = [...res.importViolations, ...res.rangeViolations];
	if (problems.length > 0) {
		console.error('A package imports or ranges a dependency its manifest does not declare:\n');
		for (const problem of problems) console.error(`  ${problem}`);
		process.exit(1);
	}

	console.log(
		`OK: every import declared across ${res.analysedCount} modules in ${res.packages.length} packages.`,
	);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main();
}
