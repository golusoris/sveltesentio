#!/usr/bin/env node
// Judges the JSON report of scripts/semgrep-scan.sh. Any finding fails, any
// semgrep error fails, and the report must name every selected file as
// scanned. One error is tolerated until its expiry, see TOLERATED.
//
// Usage: node scripts/semgrep-report.mjs REPORT FILE_LIST
// FILE_LIST is the NUL-separated list the scan received.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Category C (10 days), entered 2026-10-19: semgrep 1.180.0 parses the regex
// literal on line 114 (it holds `<!--` and `-->`) only partly; the same
// pattern written as new RegExp(...) parses whole. The rest of the file is
// still scanned. The emitted figure engine file needs that change at its
// source; at the expiry the error fails the scan again.
export const TOLERATED = Object.freeze([
	Object.freeze({
		type: 'PartialParsing',
		path: 'tools/figures/checks.mjs',
		line: 114,
		expires: '2026-10-29',
	}),
]);

const errorType = (error) => (Array.isArray(error.type) ? error.type[0] : error.type);

/** The tolerated entry an error matches on `today` (YYYY-MM-DD), or undefined. */
function tolerance(error, today) {
	const spans = Array.isArray(error.spans) ? error.spans : [];
	return TOLERATED.find(
		(entry) =>
			today < entry.expires &&
			errorType(error) === entry.type &&
			error.path === entry.path &&
			spans.length > 0 &&
			spans.every((span) => span.file === entry.path && span.start?.line === entry.line),
	);
}

/** Returns true when `report` carries `results` and `errors` arrays. */
function hasReportLists(report) {
	return Boolean(report && Array.isArray(report.results) && Array.isArray(report.errors));
}

/** Returns one formatted finding line from a Semgrep result entry. */
function formatFinding(result) {
	return `${result.path}:${result.start?.line}: ${result.check_id}`;
}

/** Returns one formatted problem line from an untolerated Semgrep error. */
function formatSemgrepError(error) {
	const where = error.path ?? 'no file';
	const message = error.message ?? '';
	return `semgrep error ${errorType(error)} in ${where}: ${message}`.trim();
}

/** Returns the unscanned-files problem line, or null when every selected file was scanned. */
function missingScannedProblem(report, files) {
	const scanned = new Set(report.paths?.scanned ?? []);
	const missing = files.filter((file) => !scanned.has(file));
	if (missing.length === 0) return null;
	return `${missing.length} selected files were not scanned, first ${missing[0]}`;
}

/** The reasons the report fails, empty when it passes. */
export function judge(report, files, today) {
	if (!hasReportLists(report)) {
		return ['the report has no results or errors list'];
	}
	const problems = report.results.map(formatFinding);
	for (const error of report.errors) {
		if (!tolerance(error, today)) problems.push(formatSemgrepError(error));
	}
	const unscanned = missingScannedProblem(report, files);
	if (unscanned !== null) problems.push(unscanned);
	return problems;
}

function main(argv) {
	if (argv.length !== 2) {
		console.error('usage: semgrep-report.mjs REPORT FILE_LIST');
		return 2;
	}
	let report;
	try {
		report = JSON.parse(readFileSync(argv[0], 'utf8'));
	} catch (error) {
		console.error(`semgrep: cannot read the report: ${error.message}`);
		return 1;
	}
	const files = readFileSync(argv[1], 'utf8').split('\0').filter(Boolean);
	const problems = judge(report, files, new Date().toISOString().slice(0, 10));
	for (const problem of problems) console.error(`semgrep: ${problem}`);
	if (problems.length === 0) console.log(`semgrep: ${files.length} files, no finding`);
	return problems.length === 0 ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = main(process.argv.slice(2));
}
