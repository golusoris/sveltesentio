// Parses pnpm-lock.yaml for check-playwright-image.mjs (resolved Playwright
// version, exact importer specifiers); lives apart to stay under the 500-line Lizard limit.
import { parseAllDocuments } from 'yaml';

export const PLAYWRIGHT_PACKAGES = new Set(['@playwright/test', 'playwright', 'playwright-core']),
	EXACT_VERSION_REGEX = /^\d+\.\d+\.\d+$/;

// Upper bounds (HISS-02): documents, importers, and packages in lockfile.
export const IMPORTER_LIMIT = 1_000,
	LOCK_DOC_LIMIT = 10,
	LOCK_PACKAGE_LIMIT = 10_000;

const IMPORTER_DEP_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies'];

export function isMapping(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stripPeerSuffix(version) {
	return typeof version === 'string' ? version.split('(')[0] : null;
}

function resolveLockLimits(limits = {}) {
	if (typeof limits === 'number') {
		return {
			docLimit: limits,
			importerLimit: IMPORTER_LIMIT,
			packageLimit: LOCK_PACKAGE_LIMIT,
		};
	}
	const cfg = isMapping(limits) ? limits : {};
	return {
		docLimit: cfg.docLimit ?? LOCK_DOC_LIMIT,
		importerLimit: cfg.importerLimit ?? IMPORTER_LIMIT,
		packageLimit: cfg.packageLimit ?? LOCK_PACKAGE_LIMIT,
	};
}

/**
 * Adds resolved playwright versions found in a packages dictionary.
 */
function extractPkgVersions(pkgs, versions) {
	for (const key of Object.keys(pkgs)) {
		if (key.startsWith('playwright@')) {
			versions.add(key.slice('playwright@'.length).split('(')[0]);
		}
	}
}

function collectDocsJson(docs, docLimit = LOCK_DOC_LIMIT) {
	if (docs.length > docLimit) {
		throw new Error(`pnpm-lock.yaml exceeds limit of ${docLimit} documents, got ${docs.length}`);
	}
	const docsJson = [];
	for (const doc of docs) {
		if (doc.errors?.length > 0) throw doc.errors[0];
		docsJson.push(doc.toJSON());
	}
	return docsJson;
}

function collectPlaywrightVersions(docsJson, packageLimit = LOCK_PACKAGE_LIMIT) {
	const versions = new Set();
	let totalPackages = 0;
	for (const doc of docsJson) {
		const pkgs = isMapping(doc) ? doc.packages : null;
		if (isMapping(pkgs)) {
			totalPackages += Object.keys(pkgs).length;
			if (totalPackages > packageLimit) {
				throw new Error(
					`pnpm-lock.yaml exceeds limit of ${packageLimit} packages, got ${totalPackages}`,
				);
			}
			extractPkgVersions(pkgs, versions);
		}
	}
	return versions;
}

function isValidPlaywrightEntry(specifier, entryVersion, resolvedVersion) {
	if (typeof specifier !== 'string' || !EXACT_VERSION_REGEX.test(specifier)) return false;
	if (entryVersion !== specifier) return false;
	return typeof resolvedVersion !== 'string' || specifier === resolvedVersion;
}

function checkPlaywrightEntry(importerPath, section, pkgName, entry, resolvedVersion) {
	const specifier = isMapping(entry) ? entry.specifier : undefined;
	const entryVersion = isMapping(entry) ? stripPeerSuffix(entry.version) : null;
	if (isValidPlaywrightEntry(specifier, entryVersion, resolvedVersion)) return null;
	const specDesc =
		typeof specifier === 'string' ? `'${specifier}'` : `${String(specifier)} (${typeof specifier})`;
	const expected =
		typeof resolvedVersion === 'string'
			? `exact lockfile version '${resolvedVersion}'`
			: 'an exact X.Y.Z version matching its resolved version';
	return {
		file: 'pnpm-lock.yaml',
		job: null,
		message: `importer '${importerPath}' ${section} '${pkgName}' declares specifier ${specDesc} (resolved '${entryVersion ?? 'none'}'), expected ${expected}; a range or mismatched pin lets lockfile maintenance resolve a Playwright version the container image does not carry`,
	};
}

function scanImporterSection(
	importerPath,
	section,
	sectionMap,
	resolvedVersion,
	packageLimit,
	findings,
) {
	if (!isMapping(sectionMap)) return;
	const entries = Object.entries(sectionMap);
	if (entries.length > packageLimit) {
		throw new Error(
			`pnpm-lock.yaml exceeds limit of ${packageLimit} packages in ${importerPath}.${section}, got ${entries.length}`,
		);
	}
	for (const [pkgName, entry] of entries) {
		if (!PLAYWRIGHT_PACKAGES.has(pkgName)) continue;
		const finding = checkPlaywrightEntry(importerPath, section, pkgName, entry, resolvedVersion);
		if (finding !== null) findings.push(finding);
	}
}

function scanImporter(importerPath, importerDef, resolvedVersion, packageLimit, findings) {
	if (!isMapping(importerDef)) return;
	for (const section of IMPORTER_DEP_SECTIONS) {
		scanImporterSection(
			importerPath,
			section,
			importerDef[section],
			resolvedVersion,
			packageLimit,
			findings,
		);
	}
}

function getImporterEntries(doc) {
	const importers = isMapping(doc) ? doc.importers : null;
	return isMapping(importers) ? Object.entries(importers) : null;
}

/**
 * Scans parsed lockfile documents (`doc.toJSON()`) for non-exact or drifted
 * Playwright importer specifiers.
 */
export function findPlaywrightSpecifierViolations(docsJson, resolvedVersion, limits = {}) {
	if (!Array.isArray(docsJson)) return [];
	const { docLimit, importerLimit, packageLimit } = resolveLockLimits(limits);
	if (docsJson.length > docLimit) {
		throw new Error(
			`pnpm-lock.yaml exceeds limit of ${docLimit} documents, got ${docsJson.length}`,
		);
	}
	const findings = [];
	let totalImporters = 0;
	for (const doc of docsJson) {
		const entries = getImporterEntries(doc);
		if (entries === null) continue;
		totalImporters += entries.length;
		if (totalImporters > importerLimit) {
			throw new Error(
				`pnpm-lock.yaml exceeds limit of ${importerLimit} importers, got ${totalImporters}`,
			);
		}
		for (const [importerPath, importerDef] of entries) {
			scanImporter(importerPath, importerDef, resolvedVersion, packageLimit, findings);
		}
	}
	return findings;
}

function formatVersionCountFinding(versions) {
	const msg =
		versions.size === 0
			? 'no resolved playwright package found in pnpm-lock.yaml'
			: `expected exactly one playwright version in pnpm-lock.yaml, found ${Array.from(versions).sort().join(', ')}`;
	return { file: 'pnpm-lock.yaml', message: msg };
}

/**
 * Parses lockfile source and returns the resolved playwright version or a finding.
 */
export function getPlaywrightLockVersion(lockfileSource, limits = {}) {
	const cfg = resolveLockLimits(limits);
	let versions;
	let specifierFindings;
	try {
		const docs = parseAllDocuments(lockfileSource, { uniqueKeys: true });
		const docsJson = collectDocsJson(docs, cfg.docLimit);
		versions = collectPlaywrightVersions(docsJson, cfg.packageLimit);
		const resolvedVersion = versions.size === 1 ? Array.from(versions)[0] : null;
		specifierFindings = findPlaywrightSpecifierViolations(docsJson, resolvedVersion, cfg);
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		return {
			version: null,
			finding: { file: 'pnpm-lock.yaml', message: msg },
			specifierFindings: [],
		};
	}
	if (versions.size !== 1) {
		return { version: null, finding: formatVersionCountFinding(versions), specifierFindings };
	}
	return { version: Array.from(versions)[0], finding: null, specifierFindings };
}
