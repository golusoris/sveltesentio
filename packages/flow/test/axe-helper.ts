// Bridges `axe-core` (the runtime engine) to `@sveltesentio/testing`'s pure
// `assertNoViolations` filter (ADR-0031): run axe over a rendered container with
// the framework's WCAG 2.2 AA tag set, then fail on serious/critical impacts.
import axe from 'axe-core';
import {
  WCAG_22_AA_TAGS,
  assertNoViolations,
  type AxeResultsLike,
} from '@sveltesentio/testing/a11y';

/** Runs axe against `container` and asserts no serious/critical WCAG 2.2 AA violations. */
export async function expectNoAxeViolations(container: Element): Promise<void> {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: [...WCAG_22_AA_TAGS] },
  });
  // `axe.run` returns `{ violations: Result[] }`; `Result` is structurally a
  // superset of `AxeViolation`, so the cast narrows to the filter's contract.
  assertNoViolations(results as unknown as AxeResultsLike);
}
