// Holds the release workflow to its change log formatting contract:
// release-please generates raw change logs with `*` bullets and double blank
// lines that violate prettier and markdownlint rules. A formatting job runs on
// push to the release branch so changelogs from any producer of the branch
// (release-please or the merge train) are formatted before merge. The commit
// goes through the GitHub GraphQL API, which signs the commit: main requires
// signed commits, and an unsigned commit on the release branch blocks its
// squash merge (#336). This test validates the workflow structure and verifies
// prettier + markdownlint formatting behavior in both directions on real
// upstream output.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const workflow = join(repoRoot, '.github', 'workflows', 'release-please.yml');

const STEP_START = '      - ';
const STEP_BODY = '        ';

/** The steps of the workflow's jobs, each as the list of its lines. */
function steps(source) {
	const found = [];
	for (const line of source.split('\n')) {
		if (line.startsWith(STEP_START)) {
			found.push([line]);
		} else if (found.length > 0 && line.startsWith(STEP_BODY)) {
			found.at(-1).push(line);
		}
	}
	return found;
}

function jobs(source) {
	const jobList = [];
	let inJobs = false;
	let currentJob = null;

	for (const line of source.split('\n')) {
		if (/^jobs:\s*$/.test(line)) {
			inJobs = true;
			continue;
		}
		if (!inJobs) continue;
		if (/^\S/.test(line)) {
			inJobs = false;
			continue;
		}
		const jobHeader = line.match(/^ {2}([a-zA-Z0-9_-]+):\s*$/);
		if (jobHeader) {
			currentJob = { id: jobHeader[1], lines: [line] };
			jobList.push(currentJob);
		} else if (currentJob) {
			currentJob.lines.push(line);
		}
	}
	return jobList;
}

function jobHasReleaseBranchGate(job) {
	let inJobIf = false;
	for (const line of job.lines) {
		if (/^ {4}if:\s*/.test(line)) {
			if (/github\.ref\s*==\s*['"]refs\/heads\/release-please--branches--main['"]/.test(line)) {
				return true;
			}
			inJobIf = true;
		} else if (inJobIf) {
			if (/^ {4}\S/.test(line)) {
				inJobIf = false;
			} else if (
				/github\.ref\s*==\s*['"]refs\/heads\/release-please--branches--main['"]/.test(line)
			) {
				return true;
			}
		}
	}
	return false;
}

function hasReleaseBranchTrigger(source) {
	const onMatch = source.match(/(?:^|\n)(?:'on'|on):\s*([\s\S]*?)(?=\n[a-z0-9_-]+:|$)/i);
	if (!onMatch) return false;
	const onBlock = onMatch[1];
	const pushMatch = onBlock.match(/(?:^|\n)\s*push:\s*([\s\S]*?)(?=\n\s*(?:[a-z0-9_-]+:|$)|\s*$)/i);
	if (!pushMatch) return false;
	const pushBlock = pushMatch[1];
	return (
		/\bbranches:\s*\[[^\]]*\brelease-please--branches--main\b[^\]]*\]/.test(pushBlock) ||
		/\bbranches:\s*[\r\n]+(?:\s*-[^\r\n]+[\r\n]+)*\s*-\s*['"]?release-please--branches--main['"]?/.test(
			pushBlock,
		)
	);
}

const isFormat = (step) =>
	step.some(
		(line) =>
			/\bname:\s*Format the release change logs\b/.test(line) ||
			/\bprettier\b.*CHANGELOG\.md/.test(line),
	);

/** Every reason the change log formatting step breaks the contract. */
export function formatFindings(source) {
	const list = steps(source);
	const format = list.findIndex(isFormat);
	if (format < 0) return ['step missing'];

	const findings = [];
	if (!hasReleaseBranchTrigger(source)) {
		findings.push('trigger missing');
	}

	const jobList = jobs(source);
	const formatJob = jobList.find((j) =>
		j.lines.some(
			(line) =>
				/\bname:\s*Format the release change logs\b/.test(line) ||
				/\bprettier\b.*CHANGELOG\.md/.test(line),
		),
	);
	if (!formatJob || !jobHasReleaseBranchGate(formatJob)) {
		findings.push('step without the release branch gate');
	}

	const formatStep = list[format];
	const hasPrettierWrite = formatStep.some((line) => /\bprettier\b.*--write\b/.test(line));
	const hasPrettierCheck = formatStep.some((line) => /\bprettier\b.*--check\b/.test(line));
	if (hasPrettierCheck || !hasPrettierWrite) {
		findings.push('prettier invoked with --check instead of --write');
	}
	if (formatStep.some((line) => /\bgit\s+(commit|push)\b/.test(line))) {
		findings.push('local git commit or push (unsigned)');
	}
	const hasApiCommit = formatStep.some((line) => /\bcreateCommitOnBranch\b/.test(line));
	const hasHeadGuard = formatStep.some((line) => /\bexpectedHeadOid\b/.test(line));
	if (!hasApiCommit || !hasHeadGuard) {
		findings.push('commit without createCommitOnBranch and expectedHeadOid');
	}
	return findings;
}

const ENV_KEY = `${STEP_BODY}env:`;
const ENV_ENTRY = `${STEP_BODY}  `;

/**
 * Every step `env` entry that parses a step output with fromJSON. Step `env`
 * is evaluated even when the step's `if` is false, so an empty output fails
 * the template and the whole run (release-please runs 38500794227,
 * 38503822180).
 */
export function envFindings(source) {
	const findings = [];
	for (const lines of steps(source)) {
		let inEnv = false;
		for (const line of lines) {
			if (line.trimEnd() === ENV_KEY) {
				inEnv = true;
			} else if (inEnv && line.startsWith(ENV_ENTRY)) {
				if (/\bfromJSON\(\s*steps\./.test(line)) {
					findings.push(`fromJSON of a step output in step env (${line.trim()})`);
				}
			} else {
				inEnv = false;
			}
		}
	}
	return findings;
}

const step = (...lines) => lines.map((line) => `${STEP_BODY}${line}`).join('\n');

const defaultTrigger = 'on:\n  push:\n    branches: [main, release-please--branches--main]\n';
const defaultJobGate = "    if: ${{ github.ref == 'refs/heads/release-please--branches--main' }}\n";

const formatStepFixture = (extra = {}) => {
	const prettierCmd =
		extra.prettierCmd ?? "pnpm exec prettier --write CHANGELOG.md 'packages/*/CHANGELOG.md'";
	const commitLines = extra.commitLines ?? [
		'  base=$(git rev-parse HEAD)',
		`  git diff --name-only -z | while IFS= read -r -d '' path; do`,
		`    jq -n --arg path "$path" --rawfile text "$path" '{path: $path, contents: ($text | @base64)}'`,
		`  done | jq -s --arg base "$base" '{query: "mutation($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid } } }",`,
		`    variables: {input: {expectedHeadOid: $base, fileChanges: {additions: .}}}}' >"$RUNNER_TEMP/format-commit.json"`,
		'  if ! gh api graphql --input "$RUNNER_TEMP/format-commit.json"; then',
	];
	const envEntry = extra.envEntry ?? '  BRANCH: ${{ github.ref_name }}';
	return (
		`${STEP_START}name: Format the release change logs\n` +
		`${step(
			'env:',
			envEntry,
			'run: |',
			'  corepack enable',
			'  pnpm install --frozen-lockfile',
			`  ${prettierCmd}`,
			'  # Loop safety: format commit re-triggers push; prettier diff quiet -> exit 0.',
			'  if git diff --quiet; then',
			'    exit 0',
			'  fi',
			...commitLines,
			'    if [ "$(git ls-remote origin "refs/heads/$BRANCH" | cut -f1)" != "$base" ]; then',
			'      echo "::notice::A newer run formats the moved branch"',
			'      exit 0',
			'    fi',
			'    exit 1',
			'  fi',
		)}\n`
	);
};

const workflowFixture = (extra = {}) => {
	const trigger = extra.trigger ?? defaultTrigger;
	const gate = extra.jobGate !== undefined ? extra.jobGate : defaultJobGate;
	const stepsContent = extra.steps ?? formatStepFixture(extra);
	return `${trigger}jobs:\n  format-release-pr:\n${gate}    steps:\n${stepsContent}`;
};

// Raw first entry of git show 72fea84:packages/core/CHANGELOG.md
const RAW_FIRST_ENTRY = `## [0.4.1](https://github.com/golusoris/sveltesentio/compare/core-v0.4.0...core-v0.4.1) (2026-10-13)


### Bug Fixes

* **deps:** update test tooling (major) ([#263](https://github.com/golusoris/sveltesentio/issues/263)) ([9b9faaa](https://github.com/golusoris/sveltesentio/commit/9b9faaae1e94a3fb2e0d1bb4e53a34edea926847))
`;

const EXISTING_ENTRY = `## [0.4.0](https://github.com/golusoris/sveltesentio/compare/core-v0.3.0...core-v0.4.0) (2026-10-12)

### ⚠ BREAKING CHANGES

- **licence:** licence MIT -> EUPL-1.2.
`;

function loadMarkdownlint() {
	const toolPkg = join(repoRoot, 'tools', 'markdownlint', 'package.json');
	try {
		const req = createRequire(toolPkg);
		return {
			lint: req('markdownlint/sync').lint,
			yaml: req('js-yaml'),
		};
	} catch (error) {
		// Only a missing install falls through to the locked install; verify.mjs installs the
		// same lockfile the same way. Any other load error fails the test.
		if (error?.code !== 'MODULE_NOT_FOUND') throw error;
		execFileSync(
			'npm',
			[
				'--prefix',
				join(repoRoot, 'tools', 'markdownlint'),
				'ci',
				'--ignore-scripts',
				'--no-audit',
				'--no-fund',
			],
			{ stdio: 'pipe', timeout: 120000 },
		);
		const req = createRequire(toolPkg);
		return {
			lint: req('markdownlint/sync').lint,
			yaml: req('js-yaml'),
		};
	}
}

describe('release-please.yml changelog format step', () => {
	it('holds for the workflow in this repository', () => {
		assert.deepEqual(formatFindings(readFileSync(workflow, 'utf8')), []);
		assert.deepEqual(envFindings(readFileSync(workflow, 'utf8')), []);
	});

	it('accepts the raw step output in step env', () => {
		assert.deepEqual(envFindings(workflowFixture()), []);
	});

	it('detects fromJSON of a step output in step env', () => {
		const envEntry = '  BRANCH: ${{ fromJSON(steps.release.outputs.pr).headBranchName }}';
		assert.deepEqual(envFindings(workflowFixture({ envEntry })), [
			`fromJSON of a step output in step env (${envEntry.trim()})`,
		]);
	});

	it('boundary: fromJSON of a step output in with is evaluated only when the step runs', () => {
		const checkout =
			`${STEP_START}uses: actions/checkout@0123 # v0\n` +
			`${step('with:', '  ref: ${{ fromJSON(steps.release.outputs.pr).headBranchName }}')}\n`;
		assert.deepEqual(envFindings(workflowFixture({ steps: checkout })), []);
	});

	it('detects step missing', () => {
		assert.deepEqual(formatFindings(workflowFixture({ steps: '' })), ['step missing']);
	});

	it('detects trigger missing', () => {
		assert.deepEqual(
			formatFindings(workflowFixture({ trigger: 'on:\n  push:\n    branches: [main]\n' })),
			['trigger missing'],
		);
	});

	it('detects step without the release branch gate', () => {
		assert.deepEqual(
			formatFindings(
				workflowFixture({ jobGate: "    if: ${{ github.ref == 'refs/heads/main' }}\n" }),
			),
			['step without the release branch gate'],
		);
		assert.deepEqual(formatFindings(workflowFixture({ jobGate: '' })), [
			'step without the release branch gate',
		]);
	});

	it('boundary: release branch gate without expression syntax is accepted', () => {
		assert.deepEqual(
			formatFindings(
				workflowFixture({
					jobGate: "    if: github.ref == 'refs/heads/release-please--branches--main'\n",
				}),
			),
			[],
		);
	});

	it('boundary: push trigger with YAML sequence syntax is accepted', () => {
		assert.deepEqual(
			formatFindings(
				workflowFixture({
					trigger:
						'on:\n  push:\n    branches:\n      - main\n      - release-please--branches--main\n',
				}),
			),
			[],
		);
	});

	it('detects prettier invoked with --check instead of --write', () => {
		assert.deepEqual(
			formatFindings(
				workflowFixture({
					prettierCmd: "pnpm exec prettier --check CHANGELOG.md 'packages/*/CHANGELOG.md'",
				}),
			),
			['prettier invoked with --check instead of --write'],
		);
	});

	it('accepts the API commit with its head guard', () => {
		assert.deepEqual(formatFindings(workflowFixture()), []);
	});

	it('detects a local git commit and push', () => {
		const commitLines = [
			'  git commit -am "chore: format the generated change logs"',
			'  base=$(git rev-parse HEAD~1)',
			'  if ! git push origin "HEAD:refs/heads/$BRANCH"; then',
		];
		assert.deepEqual(formatFindings(workflowFixture({ commitLines })), [
			'local git commit or push (unsigned)',
			'commit without createCommitOnBranch and expectedHeadOid',
		]);
	});

	it('boundary: the API commit without expectedHeadOid is refused', () => {
		const commitLines = [
			`  jq -n '{query: "mutation { createCommitOnBranch(input: $input) { commit { oid } } }"}' >"$RUNNER_TEMP/c.json"`,
			'  if ! gh api graphql --input "$RUNNER_TEMP/c.json"; then',
		];
		assert.deepEqual(formatFindings(workflowFixture({ commitLines })), [
			'commit without createCommitOnBranch and expectedHeadOid',
		]);
	});
});

describe('raw upstream changelog formatting both directions', () => {
	it('formats raw upstream output to satisfy prettier and markdownlint', () => {
		const prettierBin = join(repoRoot, 'node_modules', '.bin', 'prettier');
		const prettierConfig = join(repoRoot, 'prettier.config.js');
		const { lint, yaml } = loadMarkdownlint();
		const lintConfigFile = join(repoRoot, 'tools', 'markdownlint', 'markdownlint-cli2.yaml');
		const lintConfig = yaml.load(readFileSync(lintConfigFile, 'utf8')).config;

		const tmpDir = mkdtempSync(join(tmpdir(), 'changelog-format-test-'));
		const clPath = join(tmpDir, 'CHANGELOG.md');

		try {
			const rawContent = `# Changelog\n\n${RAW_FIRST_ENTRY}\n${EXISTING_ENTRY}`;
			writeFileSync(clPath, rawContent, 'utf8');

			// Before formatting: prettier --check must fail (nonzero)
			assert.throws(
				() =>
					execFileSync(prettierBin, ['--check', '--config', prettierConfig, clPath], {
						stdio: 'pipe',
						timeout: 30000,
					}),
				/Command failed/u,
			);

			// Before formatting: markdownlint reports MD004 and MD012
			const resultsBefore = lint({
				strings: { [clPath]: rawContent },
				config: lintConfig,
			});
			const beforeRuleNames = (resultsBefore[clPath] ?? []).map((r) => r.ruleNames[0]);
			assert.ok(beforeRuleNames.includes('MD004'));
			assert.ok(beforeRuleNames.includes('MD012'));

			// Format with prettier --write
			execFileSync(prettierBin, ['--write', '--config', prettierConfig, clPath], {
				stdio: 'pipe',
				timeout: 30000,
			});

			// After formatting: prettier --check must succeed (exit 0)
			const checkResult = execFileSync(
				prettierBin,
				['--check', '--config', prettierConfig, clPath],
				{ stdio: 'pipe', timeout: 30000 },
			);
			assert.ok(checkResult !== undefined);

			// After formatting: markdownlint reports no issues
			const formattedContent = readFileSync(clPath, 'utf8');
			const resultsAfter = lint({
				strings: { [clPath]: formattedContent },
				config: lintConfig,
			});
			const afterRuleNames = (resultsAfter[clPath] ?? []).map((r) => r.ruleNames[0]);
			assert.deepEqual(afterRuleNames, []);
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});
