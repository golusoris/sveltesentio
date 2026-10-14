// Core Web Vitals inside the Playwright end-to-end suites of auth, media and
// shell (docs/principles.md §2.9). Each suite calls `installWebVitals` before
// it opens its harness, `settleWebVitals` once the page has loaded and before
// the first interaction, and `webVitalsOverBudget` after every test.
//
// web-vitals runs in the page as its UMD build: an init script is a classic
// script, and the UMD build defines the `webVitals` global there. Every metric
// reports all changes, so a value exists without a page hide. INP observes
// interactions from 16 ms on (the browser's minimum) instead of 40 ms, so a
// fast interaction reports a value rather than none.
//
// A metric the engine can measure must report a value: an injection that stops
// working fails the suite instead of passing with nothing measured. Which
// metrics an engine can measure follows from its supported performance entry
// types, read in the page (Chromium all five, Firefox all but CLS, measured
// 2026-10-14).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';

/**
 * Budgets per metric: LCP, INP and CLS from docs/principles.md §2.9; TTFB and
 * FCP from the "good" thresholds web-vitals ships (TTFBThresholds,
 * FCPThresholds). Milliseconds, except CLS (unitless).
 */
export const WEB_VITALS_BUDGETS = Object.freeze({
	TTFB: 800,
	FCP: 1800,
	LCP: 2500,
	CLS: 0.1,
	INP: 200,
});

export type WebVitalName = keyof typeof WEB_VITALS_BUDGETS;
export type WebVitals = Partial<Record<WebVitalName, number>>;

/** The performance entry type each load metric needs; INP needs an interaction. */
const ENTRY_TYPES: Readonly<Record<Exclude<WebVitalName, 'INP'>, string>> = Object.freeze({
	TTFB: 'navigation',
	FCP: 'paint',
	LCP: 'largest-contentful-paint',
	CLS: 'layout-shift',
});

// Deadline for the load metrics to report after the page's load event.
const SETTLE_TIMEOUT_MS = 10_000;

const umd = readFileSync(createRequire(import.meta.url).resolve('web-vitals'), 'utf8');

const register = `;(() => {
	const values = (globalThis.__sveltesentioWebVitals = {});
	const put = (metric) => { values[metric.name] = metric.value; };
	const all = { reportAllChanges: true };
	webVitals.onTTFB(put, all);
	webVitals.onFCP(put, all);
	webVitals.onLCP(put, all);
	webVitals.onCLS(put, all);
	webVitals.onINP(put, { reportAllChanges: true, durationThreshold: 16 });
})();`;

/** Injects web-vitals into every document the page opens from now on. */
export async function installWebVitals(page: Page): Promise<void> {
	await page.addInitScript(`${umd}\n${register}`);
}

/** The load metrics the page's engine can measure. */
export async function measurableLoadMetrics(page: Page): Promise<WebVitalName[]> {
	const supported = await page.evaluate(() => [...PerformanceObserver.supportedEntryTypes]);
	return (Object.keys(ENTRY_TYPES) as Array<keyof typeof ENTRY_TYPES>).filter((name) =>
		supported.includes(ENTRY_TYPES[name]),
	);
}

/**
 * Waits until every load metric the engine can measure has reported. web-vitals
 * stops observing LCP at the first key press or click, so a test that
 * interacts before LCP has reported loses LCP; call this before interacting.
 */
export async function settleWebVitals(page: Page): Promise<void> {
	const required = await measurableLoadMetrics(page);
	await page.waitForFunction(
		(names) => {
			const values = (globalThis as { __sveltesentioWebVitals?: Record<string, number> })
				.__sveltesentioWebVitals;
			return values !== undefined && names.every((name) => name in values);
		},
		required,
		{ timeout: SETTLE_TIMEOUT_MS },
	);
}

/** The values web-vitals has reported in the page so far. */
export async function readWebVitals(page: Page): Promise<WebVitals> {
	return page.evaluate(
		() =>
			({
				...(globalThis as { __sveltesentioWebVitals?: Record<string, number> })
					.__sveltesentioWebVitals,
			}) as Record<string, number>,
	);
}

/**
 * One line per finding: a measurable load metric without a value, or a value
 * over its budget. Empty when the page is within budget.
 */
export function budgetFindings(
	vitals: WebVitals,
	required: readonly WebVitalName[],
	budgets: Readonly<Record<WebVitalName, number>> = WEB_VITALS_BUDGETS,
): string[] {
	const findings = required
		.filter((name) => vitals[name] === undefined)
		.map((name) => `${name}: no value reported`);
	for (const name of Object.keys(budgets) as WebVitalName[]) {
		const value = vitals[name];
		if (value !== undefined && value > budgets[name]) {
			findings.push(`${name}: ${value} over the budget of ${budgets[name]}`);
		}
	}
	return findings;
}

/** Reads the page's values and returns its findings against the budgets. */
export async function webVitalsOverBudget(page: Page): Promise<string[]> {
	const required = await measurableLoadMetrics(page);
	return budgetFindings(await readWebVitals(page), required);
}
