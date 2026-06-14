// @sveltesentio/testing/playwright-axe — Playwright fixture preset (ADR-0031).
//
// Pure-data + filter helpers. Consumers compose with @axe-core/playwright via
// `import AxeBuilder from '@axe-core/playwright'` in their fixture file; this
// module only ships the sveltesentio defaults + impact-gating helper.

import {
	DEFAULT_IMPACT_FAIL_LEVELS,
	WCAG_22_AA_TAGS,
	filterViolationsByImpact,
	type AxeImpact,
	type AxeViolation,
} from './a11y.js';

export interface PlaywrightAxeConfig {
	readonly tags: readonly string[];
	readonly disableRules: readonly string[];
	readonly impactsFail: readonly AxeImpact[];
}

export const playwrightAxeDefaults: PlaywrightAxeConfig = Object.freeze({
	tags: WCAG_22_AA_TAGS,
	disableRules: Object.freeze([]),
	impactsFail: DEFAULT_IMPACT_FAIL_LEVELS,
});

export interface AxeConfigOverrides {
	readonly tags?: readonly string[];
	readonly disableRules?: readonly string[];
	readonly impactsFail?: readonly AxeImpact[];
}

export function axeConfig(overrides: AxeConfigOverrides = {}): PlaywrightAxeConfig {
	return Object.freeze({
		tags: overrides.tags ?? playwrightAxeDefaults.tags,
		disableRules: overrides.disableRules ?? playwrightAxeDefaults.disableRules,
		impactsFail: overrides.impactsFail ?? playwrightAxeDefaults.impactsFail,
	});
}

export function filterPlaywrightViolations(
	violations: readonly AxeViolation[],
	impactsFail: readonly AxeImpact[] = DEFAULT_IMPACT_FAIL_LEVELS,
): readonly AxeViolation[] {
	return filterViolationsByImpact(violations, impactsFail);
}

export interface AxeBuilderLike {
	withTags(tags: readonly string[]): AxeBuilderLike;
	disableRules(rules: readonly string[]): AxeBuilderLike;
}

export function applyAxeConfig<B extends AxeBuilderLike>(
	builder: B,
	config: PlaywrightAxeConfig = playwrightAxeDefaults,
): B {
	let next = builder.withTags(config.tags);
	if (config.disableRules.length > 0) next = next.disableRules(config.disableRules);
	return next as B;
}
