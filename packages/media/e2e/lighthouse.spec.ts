import { chromium, expect, test } from '@playwright/test';
import lighthouse from 'lighthouse';

// Lighthouse over the production build of the harness (`vite build` +
// `vite preview`, the `lighthouse` project in playwright.config.ts); scores
// against the dev server measure Vite's unbundled modules, not the app.
// Thresholds: category scores from docs/ux-principles.md, LCP from
// docs/principles.md §2.9, the image weight from
// docs/compose/image-optimization.md.

/** DevTools port of the Chromium instance Lighthouse drives. */
const DEBUG_PORT = 9333;

const MIN_SCORES = Object.freeze({
	performance: 0.8,
	accessibility: 0.95,
	'best-practices': 0.9,
});

const MAX_LCP_MS = 2500;
const MAX_IMAGE_BYTES = 100_000;

// One Lighthouse run took 5.4 to 7.9 seconds locally (2026-10-14,
// .workingdir/evidence/x10-perf-gate/); the deadline leaves room for a slower
// hosted runner.
const RUN_DEADLINE_MS = 60_000;

interface NetworkRequest {
	url: string;
	resourceType?: string;
	transferSize?: number;
}

test('the production harness meets the Lighthouse budgets', async ({ baseURL }) => {
	test.setTimeout(RUN_DEADLINE_MS * 2);
	const url = `${baseURL ?? ''}/`;
	const browser = await chromium.launch({ args: [`--remote-debugging-port=${DEBUG_PORT}`] });
	let deadline: ReturnType<typeof setTimeout> | undefined;
	try {
		const started = performance.now();
		const result = await Promise.race([
			lighthouse(url, {
				port: DEBUG_PORT,
				output: 'json',
				logLevel: 'error',
				onlyCategories: Object.keys(MIN_SCORES),
			}),
			new Promise<never>((_, reject) => {
				deadline = setTimeout(
					() => reject(new Error('Lighthouse run over its deadline')),
					RUN_DEADLINE_MS,
				);
			}),
		]);
		const elapsed = Math.round(performance.now() - started);
		console.log(`lighthouse: ${url} took ${elapsed} ms`);
		const lhr = result?.lhr;
		expect(lhr, 'Lighthouse returned no result').toBeDefined();
		if (lhr === undefined) return;
		expect(lhr.runWarnings).toEqual([]);

		const scores = Object.fromEntries(
			Object.keys(MIN_SCORES).map((id) => [id, lhr.categories[id]?.score ?? 0]),
		);
		const lowScores = Object.entries(MIN_SCORES)
			.filter(([id, min]) => (scores[id] ?? 0) < min)
			.map(([id, min]) => `${id}: ${scores[id]} under ${min}`);
		expect.soft(lowScores).toEqual([]);

		const lcp = lhr.audits['largest-contentful-paint']?.numericValue;
		expect(lcp, 'largest-contentful-paint audit has no value').toBeDefined();
		expect.soft(lcp ?? Infinity).toBeLessThanOrEqual(MAX_LCP_MS);

		const requests = (lhr.audits['network-requests']?.details as { items?: NetworkRequest[] })
			?.items;
		expect(requests, 'network-requests audit has no items').toBeDefined();
		const heavyImages = (requests ?? [])
			.filter((r) => r.resourceType === 'Image' && (r.transferSize ?? 0) > MAX_IMAGE_BYTES)
			.map((r) => `${r.url}: ${r.transferSize} bytes over ${MAX_IMAGE_BYTES}`);
		expect.soft(heavyImages).toEqual([]);
	} finally {
		clearTimeout(deadline);
		await browser.close();
	}
});
