#!/usr/bin/env node
// Fails if main's ruleset requires a sole maintainer to approve their own PR,
// omits an admin bypass, disables enforcement, or does not require CI Gate.
// Checks that the workflow publishes CI Gate for main, always aggregates every
// other job, and uses GitHub Actions when the required check pins an integration.
// Guards the solo-maintainer fix in 8c2704d against regeneration by adopt's
// team-oriented template, which can otherwise make the default branch unmergeable.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { IO_TIMEOUT_MS, readDocument } from './check-platform-legs.mjs';

const defaultRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const RULESET_PATH = '.github/rulesets/main.json';
const WORKFLOW_PATH = '.github/workflows/ci.yml';

export const ADMIN_ROLE_ID = 5;
export const BYPASS_MODES = ['always', 'pull_request'];
export const GATE_CONTEXT = 'CI Gate';
export const GITHUB_ACTIONS_APP_ID = 15368;
export const CATCH_ALL_PATTERNS = ['*', '**'];
export const CODEOWNERS_CANDIDATES = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'];
export const CODEOWNERS_LINE_LIMIT = 2_000;
export const USER_OWNER_RE = /^@[a-z\d][a-z\d-]{0,38}$/i;
export const TEAM_OWNER_RE = /^@[a-z\d][a-z\d-]*\/[a-z\d][\w.-]*$/i;
export const EMAIL_OWNER_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function parseOwnerRule(line) {
	// Preserve escaped spaces; GitHub support for this pattern syntax remains unverified.
	const [, pattern, rest] = /^((?:\\\s|\S)+)\s*(.*)$/.exec(line);
	const users = new Set();
	const others = new Set();
	const tokens = rest.split(/\s+/);
	for (let i = 0; i < tokens.length; i++) {
		const owner = tokens[i];
		if (owner.startsWith('#')) break;
		if (USER_OWNER_RE.test(owner)) {
			users.add(owner.toLowerCase());
		} else if (TEAM_OWNER_RE.test(owner) || EMAIL_OWNER_RE.test(owner)) {
			others.add(owner);
		}
	}
	return { pattern, users, others };
}

function collectRuleOwners(rule, users, others) {
	for (const user of rule.users) users.add(user);
	for (const other of rule.others) others.add(other);
}

/**
 * Return ordered effective rules and the union of their owners.
 * Catch-alls reset earlier rules; identical patterns retain only their last rule.
 * Distinct patterns are not glob-matched against each other; overlaps stay conservatively.
 */
export function parseCodeowners(source) {
	const users = new Set();
	const others = new Set();
	let rules = [];
	const lines = source.split(/\r?\n/);
	if (lines.at(-1) === '') lines.pop();
	if (lines.length > CODEOWNERS_LINE_LIMIT) {
		return { users, others, rules, error: `exceeds ${CODEOWNERS_LINE_LIMIT} lines` };
	}
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		if (line === '' || line.startsWith('#')) continue;
		const rule = parseOwnerRule(line);
		rules = CATCH_ALL_PATTERNS.includes(rule.pattern)
			? []
			: rules.filter((earlier) => earlier.pattern !== rule.pattern);
		rules.push(rule);
	}
	for (let i = 0; i < rules.length; i++) {
		collectRuleOwners(rules[i], users, others);
	}
	return { users, others, rules, error: null };
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
	if (owners.others.size > 0 || owners.users.size > 1) {
		const requiresOwners = rules.some(
			(rule) =>
				rule?.type === 'pull_request' && rule.parameters?.require_code_owner_review === true,
		);
		if (requiresOwners) checkOwnedPatterns(owners.rules, findings);
		return;
	}
	for (let i = 0; i < rules.length; i++) {
		if (rules[i]?.type === 'pull_request') checkReviews(rules[i], findings);
	}
}

function checkOwnedPatterns(rules, findings) {
	for (let i = 0; i < rules.length; i++) {
		const { pattern, users, others } = rules[i];
		if (users.size === 1 && others.size === 0) {
			findings.push(
				`${RULESET_PATH}: require_code_owner_review: CODEOWNERS pattern '${pattern}' ` +
					'has a single owner, who cannot approve their own pull request',
			);
		}
	}
}

function checkEnforcement(doc, findings) {
	if (doc.enforcement !== 'active') {
		findings.push(
			`${RULESET_PATH}: enforcement is '${doc.enforcement}', so the required ` +
				`'${GATE_CONTEXT}' check does not block merges`,
		);
	}
}

function checkIntegration(check, findings) {
	if (check?.context !== GATE_CONTEXT || check.integration_id === undefined) return;
	if (check.integration_id !== GITHUB_ACTIONS_APP_ID) {
		findings.push(
			`${RULESET_PATH}: '${GATE_CONTEXT}' is pinned to integration ` +
				`${check.integration_id}, not GitHub Actions (${GITHUB_ACTIONS_APP_ID})`,
		);
	}
}

function checkGateIntegrations(rules, findings) {
	for (let i = 0; i < rules.length; i++) {
		if (rules[i]?.type !== 'required_status_checks') continue;
		const checks = rules[i].parameters?.required_status_checks;
		if (!Array.isArray(checks)) continue;
		for (let j = 0; j < checks.length; j++) checkIntegration(checks[j], findings);
	}
}

function checkWorkflowTriggers(doc, findings) {
	const events = ['push', 'pull_request'];
	for (let i = 0; i < events.length; i++) {
		const event = events[i];
		const branches = doc?.on?.[event]?.branches;
		if (!Array.isArray(branches) || !branches.includes('main')) {
			findings.push(`${WORKFLOW_PATH}: on.${event}.branches must include main`);
		}
	}
}

function checkGateJob(id, job, jobIds, findings) {
	if (job.if !== 'always()' && job.if !== '${{ always() }}') {
		findings.push(`${WORKFLOW_PATH}: '${GATE_CONTEXT}' job if must be always()`);
	}
	const needs = typeof job.needs === 'string' ? [job.needs] : job.needs;
	const required = jobIds.filter((jobId) => jobId !== id);
	const missing = required.filter((jobId) => !Array.isArray(needs) || !needs.includes(jobId));
	if (missing.length > 0) {
		findings.push(`${WORKFLOW_PATH}: '${GATE_CONTEXT}' job needs missing: ${missing.join(', ')}`);
	}
}

async function checkGateWorkflow(rootDir, findings) {
	const result = await readDocument(join(rootDir, WORKFLOW_PATH), WORKFLOW_PATH, 'YAML', parse);
	if (result.error) {
		findings.push(result.error);
		return;
	}
	checkWorkflowTriggers(result.doc, findings);
	const jobs = Object.entries(result.doc?.jobs ?? {});
	const gates = jobs.filter(([, job]) => job?.name === GATE_CONTEXT);
	if (gates.length === 0) {
		findings.push(`${WORKFLOW_PATH}: no job publishes '${GATE_CONTEXT}'`);
	} else if (gates.length !== 1) {
		findings.push(`${WORKFLOW_PATH}: exactly one job must publish '${GATE_CONTEXT}'`);
	} else {
		const [id, job] = gates[0];
		checkGateJob(
			id,
			job,
			jobs.map(([jobId]) => jobId),
			findings,
		);
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
	checkEnforcement(doc, findings);
	checkGateIntegrations(doc.rules, findings);
	if (!doc.rules.some(requiresGate)) {
		findings.push(
			`${RULESET_PATH}: missing '${GATE_CONTEXT}', the aggregator that reports whether ` +
				'the whole pipeline passed',
		);
	}
	await checkGateWorkflow(rootDir, findings);
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
