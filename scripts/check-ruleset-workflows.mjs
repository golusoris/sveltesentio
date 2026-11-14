// Resolve bounded workflow publishers and judge pull_request filters against main.
// Shared trigger diagnostics keep the CI Gate contract in check-ruleset.mjs unchanged.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { IO_TIMEOUT_MS, readDocument } from './check-platform-legs.mjs';
import { withTimeout } from './check-template-labels.mjs';

const WORKFLOW_DIR = '.github/workflows';
const WORKFLOW_LIMIT = 100;
const MATRIX_LIMIT = 256;
const JOB_LIMIT = 256;
const FILTER_LIMIT = 100;
const PATTERN_LIMIT = 255;
const MATRIX_EXPRESSION_RE = /\$\{\{\s*matrix\.([A-Za-z_][\w-]*)\s*\}\}/g;
const CONSTANT_FALSE_RE = /^\s*(?:false|\$\{\{\s*false\s*\}\})\s*$/;
const LOCAL_WORKFLOW_RE = /^\.\/\.github\/workflows\/[\w.-]+\.ya?ml$/;

/** Recognize YAML mappings, excluding null and sequences. */
function isMapping(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Recognize bounded event lists or a mapping with its own named event. */
function hasEvent(trigger, event) {
	if (typeof trigger === 'string') return trigger === event;
	if (Array.isArray(trigger)) {
		return trigger.length <= FILTER_LIMIT && trigger.includes(event);
	}
	return isMapping(trigger) && Object.hasOwn(trigger, event);
}

/** Only valid pull_request event shapes can publish contexts for this check. */
export function publishesPullRequest(doc) {
	const trigger = doc?.on;
	if (!hasEvent(trigger, 'pull_request')) return false;
	if (!isMapping(trigger)) return true;
	return trigger.pull_request === null || isMapping(trigger.pull_request);
}

/** Preserve trigger-filter diagnostics shared with the CI Gate checker. */
export function checkTriggerFilters(
	event,
	trigger,
	findings,
	relPath,
	context,
	filters = ['paths', 'paths-ignore', 'branches-ignore'],
) {
	for (let i = 0; i < filters.length; i++) {
		const key = filters[i];
		if (trigger && Object.hasOwn(trigger, key)) {
			findings.push(
				`${relPath}: on.${event}.${key} can skip the workflow and leave '${context}' pending`,
			);
		}
	}
}

/** Preserve required pull-request activity diagnostics for bounded type lists. */
export function checkPullRequestTypes(trigger, findings, relPath) {
	if (!trigger || !Object.hasOwn(trigger, 'types')) return;
	const required = ['opened', 'synchronize', 'reopened'];
	if (!Array.isArray(trigger.types) || !required.every((type) => trigger.types.includes(type))) {
		findings.push(
			`${relPath}: on.pull_request.types must include opened, synchronize and reopened`,
		);
	}
}

/** Accept literal scalar matrix values only. */
function isMatrixScalar(value) {
	return ['string', 'number', 'boolean'].includes(typeof value);
}

/** Lowercase bounded mapping keys, refusing collisions and invalid values. */
function normalizeMatrixMapping(value, accepts) {
	if (!isMapping(value)) return null;
	const entries = Object.entries(value);
	if (entries.length > MATRIX_LIMIT) return null;
	const result = Object.create(null);
	for (let i = 0; i < entries.length; i++) {
		const [key, item] = entries[i];
		const lower = key.toLowerCase();
		if (Object.hasOwn(result, lower) || !accepts(item)) return null;
		result[lower] = item;
	}
	return result;
}

/** Normalize bounded include/exclude lists before applying matrix semantics. */
function matrixEntries(value) {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.length > MATRIX_LIMIT) return null;
	const entries = [];
	for (let i = 0; i < value.length; i++) {
		const entry = normalizeMatrixMapping(value[i], isMatrixScalar);
		if (entry === null) return null;
		entries.push(entry);
	}
	return entries;
}

/** Check an axis before its values are traversed. */
function isMatrixAxis(value) {
	return (
		Array.isArray(value) &&
		value.length > 0 &&
		value.length <= MATRIX_LIMIT &&
		value.every(isMatrixScalar)
	);
}

/** Expand axes with an early product cutoff before each bounded fan-out. */
function axisCombinations(axes) {
	let combinations = [{}];
	for (let i = 0; i < axes.length; i++) {
		const [key, values] = axes[i];
		if (!isMatrixAxis(values)) return null;
		if (combinations.length * values.length > MATRIX_LIMIT) return null;
		combinations = combinations.flatMap((entry) =>
			values.map((value) => ({ ...entry, [key]: value })),
		);
	}
	return combinations;
}

/** Match every key of a normalized, bounded matrix entry. */
function combinationMatches(combination, entry) {
	return Object.keys(entry).every((key) => combination[key] === entry[key]);
}

/** Merge includes into original combinations only; appended combinations never become targets. */
function applyMatrixIncludes(originals, include) {
	const combinations = originals.map((entry) => ({ ...entry }));
	for (let i = 0; i < include.length; i++) {
		const entry = include[i];
		let matched = false;
		for (let j = 0; j < originals.length; j++) {
			const fits = Object.keys(entry).every(
				(key) => !Object.hasOwn(originals[j], key) || originals[j][key] === entry[key],
			);
			if (!fits) continue;
			combinations[j] = { ...combinations[j], ...entry };
			matched = true;
		}
		if (!matched) combinations.push({ ...entry });
		if (combinations.length > MATRIX_LIMIT) return [];
	}
	return combinations;
}

/** Expand bounded case-insensitive axes, partial excludes, and GitHub-style includes. */
export function matrixCombinations(matrix) {
	const normalized = normalizeMatrixMapping(matrix, () => true);
	if (normalized === null) return [];
	const axes = Object.entries(normalized).filter(([key]) => !['include', 'exclude'].includes(key));
	const include = matrixEntries(normalized.include);
	const exclude = matrixEntries(normalized.exclude);
	if (include === null || exclude === null) return [];
	const axisKeys = new Set(axes.map(([key]) => key));
	if (exclude.some((entry) => Object.keys(entry).some((key) => !axisKeys.has(key)))) return [];
	if (axes.length === 0) return include.map((entry) => ({ ...entry }));
	const combinations = axisCombinations(axes);
	if (combinations === null) return [];
	const originals = combinations.filter(
		(entry) => !exclude.some((excluded) => combinationMatches(entry, excluded)),
	);
	return applyMatrixIncludes(originals, include);
}

/** Substitute keys case-insensitively only when every referenced key is present. */
function expandMatrixName(name, combination) {
	let missing = false;
	const expanded = name.replace(MATRIX_EXPRESSION_RE, (_, key) => {
		const lower = key.toLowerCase();
		if (!Object.hasOwn(combination, lower)) {
			missing = true;
			return '';
		}
		return String(combination[lower]);
	});
	return missing ? [] : [expanded];
}

/** Default absent non-matrix names to the job id; expressions never become literals. */
function literalJobNames(id, job) {
	if (!Object.hasOwn(job, 'name')) return [id];
	return typeof job.name === 'string' && !job.name.includes('${{') ? [job.name] : [];
}

/**
 * Detect a statically false condition. A skipped job still reports Success under its own name,
 * but GitHub skips a matrix job before expanding it and a skipped caller never starts its callee.
 */
function isConstantFalse(job) {
	return job.if === false || (typeof job.if === 'string' && CONSTANT_FALSE_RE.test(job.if));
}

/** Require a runner value that is present and not null. */
function hasRunner(job) {
	return Object.hasOwn(job, 'runs-on') && job['runs-on'] !== undefined && job['runs-on'] !== null;
}

/** Accept GitHub's two job forms only: a runner job, or a reusable call without a runner. */
function hasValidJobShape(job) {
	if (!isMapping(job)) return false;
	if (!Object.hasOwn(job, 'uses')) return hasRunner(job);
	return typeof job.uses === 'string' && !Object.hasOwn(job, 'runs-on');
}

/** Require an ordinary job's runner without accepting absent or null runner values. */
function isRunnableJob(job) {
	return isMapping(job) && !Object.hasOwn(job, 'uses') && hasRunner(job);
}

/** Resolve runnable literal jobs and bounded matrices, excluding reusable calls. */
export function publishedJobNames(id, job) {
	if (!isRunnableJob(job)) return [];
	const name = job.name;
	const matrix = job.strategy?.matrix;
	if (matrix === undefined) return literalJobNames(id, job);
	if (isConstantFalse(job)) return [];
	if (typeof name !== 'string' || !name.includes('${{')) return [];
	if (name.replace(MATRIX_EXPRESSION_RE, '').includes('${{')) return [];
	return matrixCombinations(matrix).flatMap((entry) => expandMatrixName(name, entry));
}

/** Accept a local, literally named, unconditional caller without a matrix. */
function isResolvableCaller(job) {
	if (typeof job.uses !== 'string' || !LOCAL_WORKFLOW_RE.test(job.uses)) return false;
	if (typeof job.name !== 'string' || job.name.includes('${{')) return false;
	return !isConstantFalse(job) && !(job.strategy && Object.hasOwn(job.strategy, 'matrix'));
}

/** Resolve one local reusable call against the already-read allow-list, without nesting. */
function reusableJobNames(job, documents) {
	if (!isResolvableCaller(job)) return [];
	const callee = documents.get(job.uses.slice(2));
	if (!callee || !hasEvent(callee.doc?.on, 'workflow_call')) return [];
	return callee.jobs.flatMap(([id, target]) =>
		publishedJobNames(id, target).map((name) => `${job.name} / ${name}`),
	);
}

/** Choose ordinary job or single-level reusable resolution without a recursive call graph. */
function workflowJobNames(id, job, documents) {
	if (!isMapping(job)) return [];
	return Object.hasOwn(job, 'uses') ? reusableJobNames(job, documents) : publishedJobNames(id, job);
}

/** List workflow files once, bounding directory I/O and refusing oversized inputs. */
export async function listContextWorkflows(rootDir, findings) {
	let entries;
	try {
		entries = await withTimeout(
			readdir(join(rootDir, WORKFLOW_DIR), { withFileTypes: true }),
			IO_TIMEOUT_MS,
			`readdir ${WORKFLOW_DIR}`,
		);
	} catch (error) {
		if (error.code === 'ENOENT') return [];
		findings.push(`${WORKFLOW_DIR}: cannot list workflows (${error.message})`);
		return null;
	}
	if (entries.length > WORKFLOW_LIMIT) {
		findings.push(
			`${WORKFLOW_DIR}: holds ${entries.length} entries, more than the limit of ` +
				`${WORKFLOW_LIMIT}; required status checks were not matched`,
		);
		return null;
	}
	return entries
		.filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
		.map((entry) => `${WORKFLOW_DIR}/${entry.name}`)
		.sort();
}

/** Bound jobs in both publisher and callee roles, emitting one finding per oversized file. */
function contextJobs(doc, relPath, findings) {
	const jobs = isMapping(doc?.jobs) ? Object.entries(doc.jobs) : [];
	if (jobs.length <= JOB_LIMIT) return jobs;
	findings.push(
		`${relPath}: holds ${jobs.length} jobs, more than the limit of ${JOB_LIMIT}; ` +
			'its jobs were not matched',
	);
	return [];
}

/** Drop every job of a file GitHub refuses for one job outside both job forms. */
function validContextJobs(jobs, relPath, findings) {
	const invalid = jobs.find(([, job]) => !hasValidJobShape(job));
	if (invalid === undefined) return jobs;
	findings.push(
		`${relPath}: job '${invalid[0]}' needs either runs-on or a reusable uses, not both or ` +
			'neither, so GitHub refuses the workflow; its jobs were not matched',
	);
	return [];
}

/** Read each listed workflow once and retain parsed documents for local reusable calls. */
async function readContextDocuments(rootDir, files, findings) {
	const documents = new Map();
	for (let i = 0; i < files.length; i++) {
		const relPath = files[i];
		const result = await readDocument(join(rootDir, relPath), relPath, 'YAML', parse);
		if (result.error) {
			findings.push(result.error);
			continue;
		}
		const jobs = validContextJobs(contextJobs(result.doc, relPath, findings), relPath, findings);
		documents.set(relPath, { doc: result.doc, jobs });
	}
	return documents;
}

/** Retain pull_request publishers after all bounded documents are available for lookup. */
export async function readContextWorkflows(rootDir, findings) {
	const files = await listContextWorkflows(rootDir, findings);
	if (files === null) return null;
	const documents = await readContextDocuments(rootDir, files, findings);
	const publishers = [];
	for (let i = 0; i < files.length; i++) {
		const relPath = files[i];
		const source = documents.get(relPath);
		if (!source || !publishesPullRequest(source.doc)) continue;
		const { doc, jobs } = source;
		const names = new Set(jobs.flatMap(([id, job]) => workflowJobNames(id, job, documents)));
		publishers.push({ relPath, doc, names });
	}
	return publishers;
}

/** Identify the three allowed character-range classes. */
function characterClass(character) {
	if (/[a-z]/.test(character)) return 'lower';
	if (/[A-Z]/.test(character)) return 'upper';
	if (/[0-9]/.test(character)) return 'digit';
	return null;
}

/** Add a literal or same-class ordered range from one bounded bracket expression. */
function addClassCharacters(content, index, characters) {
	const first = content[index];
	const group = characterClass(first);
	if (group === null) return null;
	if (content[index + 1] !== '-') {
		characters.add(first);
		return index;
	}
	const last = content[index + 2];
	if (last === undefined || characterClass(last) !== group || first > last) return null;
	for (let code = first.charCodeAt(0); code <= last.charCodeAt(0); code++) {
		characters.add(String.fromCharCode(code));
	}
	return index + 2;
}

/** Parse an alphanumeric class, refusing negation, malformed ranges, and missing brackets. */
function classToken(pattern, start) {
	const end = pattern.indexOf(']', start + 1);
	if (end < 0 || end === start + 1) return null;
	const content = pattern.slice(start + 1, end);
	const characters = new Set();
	for (let i = 0; i < content.length; i++) {
		const next = addClassCharacters(content, i, characters);
		if (next === null) return null;
		i = next;
	}
	return { token: { kind: 'class', characters }, end };
}

/** Parse one literal, escape, class, or star without constructing a regular expression. */
function filterToken(pattern, index) {
	const value = pattern[index];
	if (value === '[') return classToken(pattern, index);
	if (value === '\\') {
		if (index + 1 === pattern.length) return null;
		return { token: { kind: 'literal', value: pattern[index + 1] }, end: index + 1 };
	}
	if (value === '*') return starToken(pattern, index);
	return { token: { kind: 'literal', value }, end: index };
}

/**
 * Parse a star, a double star, or a double star with its slash; an unquantified slash after a
 * double star may match zero path components.
 */
function starToken(pattern, index) {
	if (pattern[index + 1] !== '*') return { token: { kind: '*' }, end: index };
	const slash = pattern[index + 2] === '/' && !['?', '+'].includes(pattern[index + 3]);
	return slash
		? { token: { kind: '**/' }, end: index + 2 }
		: { token: { kind: '**' }, end: index + 1 };
}

/** Tokenize a bounded pattern, attaching quantifiers only to unquantified literals/classes. */
function filterTokens(pattern) {
	const tokens = [];
	for (let i = 0; i < pattern.length; i++) {
		const character = pattern[i];
		if (character === '?' || character === '+') {
			const previous = tokens.at(-1);
			if (!previous || previous.quantifier || !['literal', 'class'].includes(previous.kind)) {
				return null;
			}
			previous.quantifier = character;
			continue;
		}
		const parsed = filterToken(pattern, i);
		if (parsed === null) return null;
		tokens.push(parsed.token);
		i = parsed.end;
	}
	return tokens;
}

/** Advance an NFA reach array across a bounded subject for a star token. */
function advanceFilterStar(token, subject, reach) {
	const next = new Array(subject.length + 1).fill(false);
	for (let i = 0; i <= subject.length; i++) {
		next[i] = reach[i] || (i > 0 && next[i - 1] && (token.kind === '**' || subject[i - 1] !== '/'));
	}
	return next;
}

/** Advance a double star with its slash as zero components, or any characters and one slash. */
function advanceFilterComponents(subject, reach) {
	const next = new Array(subject.length + 1).fill(false);
	let seen = false;
	for (let i = 0; i <= subject.length; i++) {
		next[i] = reach[i] || (seen && subject[i - 1] === '/');
		seen ||= reach[i];
	}
	return next;
}

/** Choose the reach update for one token. */
function advanceFilterToken(token, subject, reach) {
	if (token.kind === '**/') return advanceFilterComponents(subject, reach);
	if (token.kind === '*' || token.kind === '**') return advanceFilterStar(token, subject, reach);
	return advanceFilterCharacter(token, subject, reach);
}

/** Compare one subject character with a literal or class token. */
function filterCharacterMatches(token, character) {
	return token.kind === 'class' ? token.characters.has(character) : token.value === character;
}

/** Advance a literal/class token with zero-or-one or one-or-more repetition. */
function advanceFilterCharacter(token, subject, reach) {
	const next = new Array(subject.length + 1).fill(false);
	for (let i = 0; i <= subject.length; i++) {
		const matches = i > 0 && filterCharacterMatches(token, subject[i - 1]);
		const repeat = token.quantifier === '+' && next[i - 1];
		next[i] = matches && (reach[i - 1] || repeat);
		if (token.quantifier === '?') next[i] ||= reach[i];
	}
	return next;
}

/** Match GitHub filter syntax with bounded NFA reach arrays; null means unjudgeable input. */
export function filterPatternMatches(pattern, subject) {
	if (typeof pattern !== 'string' || typeof subject !== 'string') return null;
	if (pattern.length > PATTERN_LIMIT || subject.length > PATTERN_LIMIT) return null;
	const tokens = filterTokens(pattern);
	if (tokens === null) return null;
	let reach = new Array(subject.length + 1).fill(false);
	reach[0] = true;
	for (let i = 0; i < tokens.length; i++) {
		reach = advanceFilterToken(tokens[i], subject, reach);
	}
	return reach[subject.length];
}

/** Report an oversized filter list before any traversal of its entries. */
function filterListTooLong(trigger, key, relPath, context, findings) {
	const entries = trigger[key];
	if (!Array.isArray(entries) || entries.length <= FILTER_LIMIT) return false;
	findings.push(
		`${relPath}: on.pull_request.${key} holds ${entries.length} entries, ` +
			`more than the limit of ${FILTER_LIMIT}, for required status check '${context}'`,
	);
	return true;
}

/** Spell one unjudgeable branch-filter diagnostic for either filter key. */
function unjudgeableFilter(entry, key, relPath, context) {
	return (
		`${relPath}: on.pull_request.${key} entry '${entry}' cannot be judged against main ` +
		`for required status check '${context}'`
	);
}

/** Evaluate ordered positive/negative branch patterns against main. */
function branchPatternsIncludeMain(branches, relPath, context, findings) {
	let included = false;
	for (let i = 0; i < branches.length; i++) {
		const entry = branches[i];
		const negative = typeof entry === 'string' && entry.startsWith('!');
		const matched = filterPatternMatches(negative ? entry.slice(1) : entry, 'main');
		if (matched === null) {
			findings.push(unjudgeableFilter(entry, 'branches', relPath, context));
		} else if (matched) {
			included = !negative;
		}
	}
	return included;
}

/** Judge branches after checking shape and scalar list limit. */
function contextBranches(trigger, relPath, context, findings) {
	if (!Object.hasOwn(trigger, 'branches')) return;
	if (filterListTooLong(trigger, 'branches', relPath, context, findings)) return;
	const branches = trigger.branches;
	if (
		!Array.isArray(branches) ||
		!branchPatternsIncludeMain(branches, relPath, context, findings)
	) {
		findings.push(
			`${relPath}: on.pull_request.branches must include main ` +
				`for required status check '${context}'`,
		);
	}
}

/** Detect main-skipping ignore entries while reporting every unjudgeable entry. */
function ignoredMain(entries, relPath, context, findings) {
	let skipsMain = false;
	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		const matched =
			typeof entry === 'string' && !entry.startsWith('!')
				? filterPatternMatches(entry, 'main')
				: null;
		if (matched === null) {
			findings.push(unjudgeableFilter(entry, 'branches-ignore', relPath, context));
		} else if (matched) {
			skipsMain = true;
		}
	}
	return skipsMain;
}

/** Ignore filters are safe only when every judged pattern leaves main included. */
function contextBranchesIgnore(trigger, relPath, context, findings) {
	if (!Object.hasOwn(trigger, 'branches-ignore')) return;
	if (filterListTooLong(trigger, 'branches-ignore', relPath, context, findings)) return;
	const entries = trigger['branches-ignore'];
	if (!Array.isArray(entries) || ignoredMain(entries, relPath, context, findings)) {
		checkTriggerFilters('pull_request', trigger, findings, relPath, context, ['branches-ignore']);
	}
}

/** Append required activity diagnostics with context, after bounding type-list traversal. */
function contextTypes(trigger, relPath, context, findings) {
	if (filterListTooLong(trigger, 'types', relPath, context, findings)) return;
	const reasons = [];
	checkPullRequestTypes(trigger, reasons, relPath);
	findings.push(...reasons.map((reason) => `${reason} for required status check '${context}'`));
}

/** Explain why a publishing workflow can leave this required context pending on main. */
export function contextTriggerFindings({ doc, relPath }, context) {
	const trigger = isMapping(doc.on) ? doc.on.pull_request : null;
	if (!isMapping(trigger)) return [];
	const findings = [];
	const both = Object.hasOwn(trigger, 'branches') && Object.hasOwn(trigger, 'branches-ignore');
	if (both) {
		findings.push(
			`${relPath}: on.pull_request sets both branches and branches-ignore, ` +
				`which GitHub refuses, for required status check '${context}'`,
		);
	} else {
		contextBranches(trigger, relPath, context, findings);
	}
	contextTypes(trigger, relPath, context, findings);
	checkTriggerFilters('pull_request', trigger, findings, relPath, context, [
		'paths',
		'paths-ignore',
	]);
	if (!both) contextBranchesIgnore(trigger, relPath, context, findings);
	return findings;
}
