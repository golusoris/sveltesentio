#!/usr/bin/env node
// Reads the OpenSSF Scorecard result that scorecard.yml just published and
// fails when its aggregate score is below THRESHOLD. The analysis job cannot
// hold this check: when it publishes, the Scorecard API accepts only approved
// actions in that job, never a run step. So the threshold job runs after it
// and reads the published result from api.scorecard.dev.
//
// The result must belong to COMMIT, the commit the analysis job scored: an
// older result says nothing about main as it is now. The API can lag behind
// the publish step for a moment, so a result for another commit is fetched
// again, a bounded number of times.
//
// Environment: REPOSITORY (github.com/<owner>/<name>), COMMIT (full sha),
// THRESHOLD (number, 0..10). scorecard-threshold.test.mjs feeds it planted
// results.
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const API = 'https://api.scorecard.dev/projects/';
const FETCH_TIMEOUT_MS = 30_000;
const ATTEMPTS = 6;
const RETRY_DELAY_MS = 20_000;

/**
 * Judges one published result.
 *
 * @param {unknown} result parsed JSON from the Scorecard API
 * @param {{ commit: string, threshold: number }} want
 * @returns {{ verdict: 'pass' | 'fail' | 'stale', message: string }}
 */
export function judge(result, { commit, threshold }) {
	if (typeof result !== 'object' || result === null) {
		return { verdict: 'fail', message: 'the Scorecard API returned no result object' };
	}
	const { score, repo } = /** @type {{ score?: unknown, repo?: { commit?: unknown } }} */ (result);
	const scored = repo?.commit;
	if (typeof scored !== 'string') {
		return { verdict: 'fail', message: 'the published result names no commit' };
	}
	if (scored !== commit) {
		return { verdict: 'stale', message: `the published result is for ${scored}, not ${commit}` };
	}
	if (typeof score !== 'number' || !Number.isFinite(score)) {
		return {
			verdict: 'fail',
			message: `the published result has no numeric score (${String(score)})`,
		};
	}
	if (score < threshold) {
		return {
			verdict: 'fail',
			message: `Scorecard score ${score} is below ${threshold} at ${commit}`,
		};
	}
	return { verdict: 'pass', message: `Scorecard score ${score} meets ${threshold} at ${commit}` };
}

/**
 * Reads the environment, fetches the published result and judges it.
 *
 * @param {Record<string, string | undefined>} env
 * @param {{ fetchResult?: (url: string) => Promise<unknown>, delayMs?: number, log?: (line: string) => void }} [io]
 * @returns {Promise<0 | 1 | 2>} 0 pass, 1 fail, 2 unusable input
 */
export async function runThreshold(env, io = {}) {
	const log = io.log ?? ((line) => console.error(line));
	const { REPOSITORY: repository, COMMIT: commit, THRESHOLD: raw } = env;
	const threshold = Number(raw);
	if (
		!repository ||
		!commit ||
		raw === undefined ||
		raw === '' ||
		!(threshold >= 0 && threshold <= 10)
	) {
		log('scorecard-threshold: REPOSITORY, COMMIT and THRESHOLD (0..10) are required');
		return 2;
	}
	const fetchResult = io.fetchResult ?? defaultFetch;
	const delayMs = io.delayMs ?? RETRY_DELAY_MS;
	let outcome = { verdict: 'fail', message: 'no attempt made' };
	for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
		outcome = judge(await fetchResult(`${API}${repository}`), { commit, threshold });
		if (outcome.verdict !== 'stale') break;
		log(`scorecard-threshold: attempt ${attempt} of ${ATTEMPTS}: ${outcome.message}`);
		if (attempt < ATTEMPTS) await sleep(delayMs);
	}
	log(`scorecard-threshold: ${outcome.message}`);
	return outcome.verdict === 'pass' ? 0 : 1;
}

async function defaultFetch(url) {
	const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
	if (!response.ok) {
		throw new Error(`GET ${url}: HTTP ${response.status}`);
	}
	return response.json();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	try {
		process.exitCode = await runThreshold(process.env);
	} catch (error) {
		console.error(`scorecard-threshold: could not read the published result: ${String(error)}`);
		process.exitCode = 1;
	}
}
