// Holds the release workflow to its change log formatting contract:
// release-please generates raw change logs with `*` bullets and double blank
// lines that violate prettier and markdownlint rules. A formatting step runs
// on the release PR branch before merge, pushing formatted change logs.
// This test validates the workflow structure and verifies prettier + markdownlint
// formatting behavior in both directions on real upstream output.
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

const isRelease = (step) => step.some((line) => /\bid:\s*release\b/.test(line));

const isFormat = (step) =>
	step.some(
		(line) =>
			/\bname:\s*Format the release change logs\b/.test(line) ||
			/\bprettier\b.*CHANGELOG\.md/.test(line),
	);

/** Every reason the change log formatting step breaks the contract. */
export function formatFindings(source) {
	const list = steps(source);
	const release = list.findIndex(isRelease);
	const format = list.findIndex(isFormat);
	if (format < 0) return ['step missing'];
	if (release < 0) return ['release step missing'];
	const findings = [];
	if (format < release) {
		findings.push('step before the release step');
	}
	const formatStep = list[format];
	const hasGate = formatStep.some((line) =>
		/steps\.release\.outputs\.prs_created\s*==\s*'true'/.test(line),
	);
	if (!hasGate) {
		findings.push('step without the prs_created gate');
	}
	const hasPrettierWrite = formatStep.some((line) => /\bprettier\b.*--write\b/.test(line));
	const hasPrettierCheck = formatStep.some((line) => /\bprettier\b.*--check\b/.test(line));
	if (hasPrettierCheck || !hasPrettierWrite) {
		findings.push('prettier invoked with --check instead of --write');
	}
	const hasForcePush = formatStep.some((line) =>
		/\bgit push\b.*(\s(--force|-f|--force-with-lease)\b)/.test(line),
	);
	if (hasForcePush) {
		findings.push('push with --force');
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
const job = (...parts) => `jobs:\n  release:\n    steps:\n${parts.join('')}`;

const releaseStep =
	`${STEP_START}id: release\n` +
	`${step(
		"if: ${{ github.event_name == 'push' }}",
		'uses: googleapis/release-please-action@45996ed1f6d02564a971a2fa1b5860e934307cf7 # v5.0.0',
	)}\n`;

const formatStepFixture = (extra = {}) => {
	const gate =
		extra.gate ??
		"if: ${{ steps.release.outputs.prs_created == 'true' && steps.release.outputs.pr != '' }}";
	const prettierCmd =
		extra.prettierCmd ?? "pnpm exec prettier --write CHANGELOG.md 'packages/*/CHANGELOG.md'";
	const pushCmd = extra.pushCmd ?? 'git push origin "HEAD:refs/heads/$BRANCH"';
	const envEntry = extra.envEntry ?? '  PR_JSON: ${{ steps.release.outputs.pr }}';
	return (
		`${STEP_START}name: Format the release change logs\n` +
		`${step(
			gate,
			'working-directory: release-pr',
			'env:',
			envEntry,
			'run: |',
			`  BRANCH=$(jq -er '.headBranchName' <<<"$PR_JSON")`,
			'  corepack enable',
			'  pnpm install --frozen-lockfile',
			`  ${prettierCmd}`,
			'  if git diff --quiet; then',
			'    exit 0',
			'  fi',
			'  git config user.name "github-actions[bot]"',
			'  git config user.email "41898282+github-actions[bot]@users.noreply.github.com"',
			'  git commit -am "chore: format the generated change logs"',
			'  base=$(git rev-parse HEAD~1)',
			`  if ! ${pushCmd}; then`,
			'    if [ "$(git ls-remote origin "refs/heads/$BRANCH" | cut -f1)" != "$base" ]; then',
			'      echo "::notice::A newer run formats the moved branch"',
			'      exit 0',
			'    fi',
			'    exit 1',
			'  fi',
		)}\n`
	);
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
		assert.deepEqual(envFindings(job(releaseStep, formatStepFixture())), []);
	});

	it('detects fromJSON of a step output in step env', () => {
		const envEntry = '  BRANCH: ${{ fromJSON(steps.release.outputs.pr).headBranchName }}';
		assert.deepEqual(envFindings(job(releaseStep, formatStepFixture({ envEntry }))), [
			`fromJSON of a step output in step env (${envEntry.trim()})`,
		]);
	});

	it('boundary: fromJSON of a step output in with is evaluated only when the step runs', () => {
		const checkout =
			`${STEP_START}uses: actions/checkout@0123 # v0\n` +
			`${step('with:', '  ref: ${{ fromJSON(steps.release.outputs.pr).headBranchName }}')}\n`;
		assert.deepEqual(envFindings(job(releaseStep, checkout)), []);
	});

	it('detects step missing', () => {
		assert.deepEqual(formatFindings(job(releaseStep)), ['step missing']);
	});

	it('detects step without the prs_created gate', () => {
		assert.deepEqual(
			formatFindings(
				job(releaseStep, formatStepFixture({ gate: "if: ${{ github.event_name == 'push' }}" })),
			),
			['step without the prs_created gate'],
		);
	});

	it('detects step before the release step', () => {
		assert.deepEqual(formatFindings(job(formatStepFixture(), releaseStep)), [
			'step before the release step',
		]);
	});

	it('detects prettier invoked with --check instead of --write', () => {
		assert.deepEqual(
			formatFindings(
				job(
					releaseStep,
					formatStepFixture({
						prettierCmd: "pnpm exec prettier --check CHANGELOG.md 'packages/*/CHANGELOG.md'",
					}),
				),
			),
			['prettier invoked with --check instead of --write'],
		);
	});

	it('detects push with --force', () => {
		assert.deepEqual(
			formatFindings(
				job(
					releaseStep,
					formatStepFixture({
						pushCmd: 'git push --force origin "HEAD:refs/heads/$BRANCH"',
					}),
				),
			),
			['push with --force'],
		);
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
