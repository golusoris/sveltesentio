#!/usr/bin/env node
// Fails if main's ruleset requires a sole maintainer to approve their own PR,
// omits an admin bypass while active, or does not require the CI Gate aggregator.
// Guards the solo-maintainer fix in 8c2704d against regeneration by adopt's
// team-oriented template, which can otherwise make the default branch unmergeable.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { IO_TIMEOUT_MS, readDocument } from './check-platform-legs.mjs';

const defaultRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const RULESET_PATH = '.github/rulesets/main.json';

export const ADMIN_ROLE_ID = 5;
export const BYPASS_MODES = ['always', 'pull_request'];
export const GATE_CONTEXT = 'CI Gate';
export const CODEOWNERS_CANDIDATES = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'];
export const CODEOWNERS_LINE_LIMIT = 2_000;

function addOwners(line, users, others) {
	const tokens = line.trim().split(/\s+/);
	for (let i = 1; i < tokens.length; i++) {
		const owner = tokens[i];
		if (owner.startsWith('#')) break;
		if (owner.startsWith('@') && !owner.includes('/')) {
			users.add(owner.toLowerCase());
		} else {
			others.add(owner);
		}
	}
}

export function parseCodeowners(source) {
	const users = new Set();
	const others = new Set();
	const lines = source.split(/\r?\n/);
	if (lines.length > CODEOWNERS_LINE_LIMIT) {
		return { users, others, error: `exceeds ${CODEOWNERS_LINE_LIMIT} lines` };
	}
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		if (line === '' || line.startsWith('#')) continue;
		addOwners(line, users, others);
	}
	return { users, others, error: null };
}

async function readCodeowners(rootDir) {
	for (let i = 0; i < CODEOWNERS_CANDIDATES.length; i++) {
		const relPath = CODEOWNERS_CANDIDATES[i];
		let source;
		try {
			source = await readFile(join(rootDir, relPath), {
				encoding: 'utf8',
				signal: AbortSignal.timeout(IO_TIMEOUT_MS),
			});
		} catch (error) {
			if (error.code === 'ENOENT') continue;
			return { error: `${relPath}: cannot read file (${error.message})` };
		}
		const owners = parseCodeowners(source);
		if (owners.error) return { error: `${relPath}: ${owners.error}` };
		return owners;
	}
	return parseCodeowners('');
}

function checkReviews(rule, findings) {
	const parameters = rule.parameters;
	const requirements = [
		['required_approving_review_count', parameters?.required_approving_review_count !== 0],
		['require_code_owner_review', parameters?.require_code_owner_review === true],
		['require_last_push_approval', parameters?.require_last_push_approval === true],
	];
	for (let i = 0; i < requirements.length; i++) {
		const [name, fails] = requirements[i];
		if (fails) {
			findings.push(
				`${RULESET_PATH}: ${name}: sole maintainer cannot approve their own pull request`,
			);
		}
	}
}

function isAdminBypass(actor) {
	// RepositoryRole 5 = admin: rest-api-description issue 4406; ruleset-recipes issue 39.
	return (
		actor?.actor_type === 'RepositoryRole' &&
		actor.actor_id === ADMIN_ROLE_ID &&
		BYPASS_MODES.includes(actor.bypass_mode)
	);
}

function checkBypass(doc, findings) {
	if (doc.enforcement !== 'active') return;
	if (Array.isArray(doc.bypass_actors) && doc.bypass_actors.some(isAdminBypass)) return;
	findings.push(
		`${RULESET_PATH}: active ruleset without an admin bypass can lock the owner out ` +
			'of the default branch',
	);
}

function requiresGate(rule) {
	if (rule?.type !== 'required_status_checks') return false;
	const checks = rule.parameters?.required_status_checks;
	return Array.isArray(checks) && checks.some((check) => check?.context === GATE_CONTEXT);
}

function isRuleset(doc) {
	return doc !== null && typeof doc === 'object' && !Array.isArray(doc) && Array.isArray(doc.rules);
}

function checkSoloReviews(rules, owners, findings) {
	if (owners.others.size > 0 || owners.users.size > 1) return;
	for (let i = 0; i < rules.length; i++) {
		if (rules[i]?.type === 'pull_request') checkReviews(rules[i], findings);
	}
}

export async function checkRuleset(rootDir = defaultRoot) {
	const findings = [];
	const result = await readDocument(join(rootDir, RULESET_PATH), RULESET_PATH, 'JSON', JSON.parse);
	if (result.error) return { findings: [result.error] };
	const doc = result.doc;
	if (!isRuleset(doc)) {
		return { findings: [`${RULESET_PATH}: invalid ruleset structure (expected rules array)`] };
	}
	const owners = await readCodeowners(rootDir);
	if (owners.error) return { findings: [owners.error] };
	checkSoloReviews(doc.rules, owners, findings);
	checkBypass(doc, findings);
	if (!doc.rules.some(requiresGate)) {
		findings.push(
			`${RULESET_PATH}: missing '${GATE_CONTEXT}', the aggregator that reports whether ` +
				'the whole pipeline passed',
		);
	}
	return { findings };
}

export async function main(rootDir = defaultRoot) {
	const { findings } = await checkRuleset(rootDir);
	for (let i = 0; i < findings.length; i++) {
		console.error(findings[i]);
	}
	return findings.length > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exitCode = await main(process.argv[2] ?? defaultRoot);
}
