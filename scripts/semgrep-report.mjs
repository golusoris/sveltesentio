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

/** The reasons the report fails, empty when it passes. */
export function judge(report, files, today) {
	const problems = [];
	if (!report || !Array.isArray(report.results) || !Array.isArray(report.errors)) {
		return ['the report has no results or errors list'];
	}
	for (const result of report.results) {
		problems.push(`${result.path}:${result.start?.line}: ${result.check_id}`);
	}
	for (const error of report.errors) {
		if (!tolerance(error, today)) {
			problems.push(
				`semgrep error ${errorType(error)} in ${error.path ?? 'no file'}: ${error.message ?? ''}`.trim(),
			);
		}
	}
	const scanned = new Set(report.paths?.scanned ?? []);
	const missing = files.filter((file) => !scanned.has(file));
	if (missing.length > 0) {
		problems.push(`${missing.length} selected files were not scanned, first ${missing[0]}`);
	}
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
