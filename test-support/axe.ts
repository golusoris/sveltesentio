/**
 * Structural shape of the options passed to the axe runner.
 */
export interface AxeRunOptions {
	runOnly: { type: 'tag'; values: string[] };
}

/**
 * Structural contract for the axe runner engine.
 *
 * Injected by packages because the repository root does not install `axe-core`.
 */
export interface AxeRunnerLike {
	run(container: Element, options: AxeRunOptions): Promise<unknown>;
}

/**
 * Options for configuring the `expectNoAxeViolations` assertion helper.
 */
export interface CreateExpectNoAxeViolationsOptions<TResults = unknown> {
	/** The axe runner instance (e.g. `axe-core`). */
	axe: AxeRunnerLike;
	/**
	 * Pure violation filter asserting no serious or critical WCAG impacts
	 * (e.g. `assertNoViolations` from `@sveltesentio/testing/a11y`).
	 */
	assertNoViolations: (results: TResults) => void;
	/** WCAG tags to evaluate against (e.g. `WCAG_22_AA_TAGS`). */
	tags: readonly string[];
}

/**
 * Factory creating an `expectNoAxeViolations` helper bridging an injected axe runner
 * to an accessibility assertion filter (ADR-0031).
 *
 * Runs axe over the target container with the specified tag set and forwards
 * the results to the assertion filter.
 */
export function createExpectNoAxeViolations<TResults = unknown>(
	options: CreateExpectNoAxeViolationsOptions<TResults>,
): (container: Element) => Promise<void> {
	const values = [...options.tags];
	return async function expectNoAxeViolations(container: Element): Promise<void> {
		const results = await options.axe.run(container, {
			runOnly: { type: 'tag', values },
		});
		// `axe.run` returns `{ violations: Result[] }`; `Result` is structurally a
		// superset of the filter's violation shape, so the cast narrows to its contract.
		options.assertNoViolations(results as TResults);
	};
}
