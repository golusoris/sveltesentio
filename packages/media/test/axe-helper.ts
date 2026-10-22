import axe from 'axe-core';
import { WCAG_22_AA_TAGS, assertNoViolations } from '@sveltesentio/testing/a11y';
import { createExpectNoAxeViolations } from '../../../test-support/axe';

/** Assert the container has no serious/critical WCAG 2.2 AA axe violations. */
export const expectNoAxeViolations = createExpectNoAxeViolations({
	axe,
	assertNoViolations,
	tags: WCAG_22_AA_TAGS,
});
