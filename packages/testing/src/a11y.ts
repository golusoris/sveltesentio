// @sveltesentio/testing/a11y — vitest-axe / axe-core preset surface (ADR-0031).
//
// Ships defaults + impact filtering + a runtime assertion. Does NOT bundle
// `axe-core` or `vitest-axe`; consumers install those as Vitest dev-deps and
// pass results into `assertNoViolations`.

export type AxeImpact = 'minor' | 'moderate' | 'serious' | 'critical';

export interface AxeNodeResult {
	readonly target: readonly string[];
	readonly html: string;
	readonly failureSummary?: string | undefined;
}

export interface AxeViolation {
	readonly id: string;
	readonly impact?: AxeImpact | null | undefined;
	readonly description: string;
	readonly help?: string | undefined;
	readonly helpUrl?: string | undefined;
	readonly nodes: readonly AxeNodeResult[];
}

export interface AxeResultsLike {
	readonly violations: readonly AxeViolation[];
}

export interface AxeRunOptions {
	readonly runOnly?:
		| {
				readonly type: 'tag' | 'rule';
				readonly values: readonly string[];
		  }
		| undefined;
	readonly rules?: Readonly<Record<string, { readonly enabled: boolean }>> | undefined;
	readonly resultTypes?: readonly string[] | undefined;
	readonly include?: readonly string[] | undefined;
	readonly exclude?: readonly string[] | undefined;
	readonly elementRef?: boolean | undefined;
}

export const WCAG_22_AA_TAGS: readonly string[] = Object.freeze([
	'wcag2a',
	'wcag2aa',
	'wcag21a',
	'wcag21aa',
	'wcag22aa',
	'best-practice',
]);

export const axeDefaults: AxeRunOptions = Object.freeze({
	runOnly: Object.freeze({ type: 'tag' as const, values: WCAG_22_AA_TAGS }),
});

export const DEFAULT_IMPACT_FAIL_LEVELS: readonly AxeImpact[] = Object.freeze([
	'serious',
	'critical',
]);

type MutableAxeOptions = {
	runOnly?: AxeRunOptions['runOnly'];
	rules?: Record<string, { enabled: boolean }>;
	resultTypes?: readonly string[];
	include?: readonly string[];
	exclude?: readonly string[];
	elementRef?: boolean;
};

export function mergeAxeOptions(
	...overrides: readonly (AxeRunOptions | undefined)[]
): AxeRunOptions {
	const out: MutableAxeOptions = {};
	if (axeDefaults.runOnly !== undefined) out.runOnly = axeDefaults.runOnly;
	for (const override of overrides) {
		if (!override) continue;
		if (override.runOnly !== undefined) out.runOnly = override.runOnly;
		if (override.rules !== undefined) {
			out.rules = { ...(out.rules ?? {}), ...override.rules };
		}
		if (override.resultTypes !== undefined) out.resultTypes = override.resultTypes;
		if (override.include !== undefined) out.include = override.include;
		if (override.exclude !== undefined) out.exclude = override.exclude;
		if (override.elementRef !== undefined) out.elementRef = override.elementRef;
	}
	return out;
}

export function filterViolationsByImpact(
	violations: readonly AxeViolation[],
	fail: readonly AxeImpact[] = DEFAULT_IMPACT_FAIL_LEVELS,
): readonly AxeViolation[] {
	const allow = new Set(fail);
	return violations.filter((v) => v.impact != null && allow.has(v.impact));
}

export interface AssertNoViolationsOptions {
	readonly impactsFail?: readonly AxeImpact[];
}

export class AxeViolationsError extends Error {
	readonly violations: readonly AxeViolation[];
	constructor(violations: readonly AxeViolation[]) {
		super(formatViolations(violations));
		this.name = 'AxeViolationsError';
		this.violations = violations;
	}
}

export function assertNoViolations(
	results: AxeResultsLike,
	options: AssertNoViolationsOptions = {},
): void {
	const failing = filterViolationsByImpact(
		results.violations,
		options.impactsFail ?? DEFAULT_IMPACT_FAIL_LEVELS,
	);
	if (failing.length > 0) throw new AxeViolationsError(failing);
}

function formatViolations(violations: readonly AxeViolation[]): string {
	const lines = [`${violations.length} axe violation(s):`];
	for (const v of violations) {
		const impact = v.impact ?? 'unknown';
		lines.push(`  [${impact}] ${v.id} — ${v.description}`);
		for (const node of v.nodes) {
			lines.push(`    ${node.target.join(' ')}`);
		}
	}
	return lines.join('\n');
}
