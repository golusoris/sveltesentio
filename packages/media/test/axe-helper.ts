import axe from 'axe-core';
import { expect } from 'vitest';

// WCAG 2.2 AA tag set (mirrors @sveltesentio/testing's axeDefaults / ADR-0031).
const WCAG_22_AA_TAGS = [
	'wcag2a',
	'wcag2aa',
	'wcag21a',
	'wcag21aa',
	'wcag22aa',
	'best-practice',
];

/** Assert the container has no serious/critical WCAG 2.2 AA axe violations. */
export async function expectNoAxeViolations(container: HTMLElement): Promise<void> {
	const results = await axe.run(container, {
		runOnly: { type: 'tag', values: WCAG_22_AA_TAGS },
		resultTypes: ['violations'],
	});
	const serious = results.violations.filter(
		(v) => v.impact === 'serious' || v.impact === 'critical',
	);
	expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
}
