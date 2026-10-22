import axe from 'axe-core';
import { WCAG_22_AA_TAGS, assertNoViolations } from '@sveltesentio/testing/a11y';
import { createExpectNoAxeViolations } from '../../../test-support/axe';

/** Runs axe against `container` and asserts no serious/critical WCAG 2.2 AA violations. */
export const expectNoAxeViolations = createExpectNoAxeViolations({
	axe,
	assertNoViolations,
	tags: WCAG_22_AA_TAGS,
});
