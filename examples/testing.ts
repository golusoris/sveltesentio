// Shared test kit: deterministic clock + axe-core WCAG 2.2 AA defaults.
import {
	testClock,
	axeDefaults,
	WCAG_22_AA_TAGS,
	DEFAULT_IMPACT_FAIL_LEVELS,
} from '@sveltesentio/testing';
import { setClock } from '@sveltesentio/core';

setClock(testClock(0)); // freeze time for stable snapshots
export const results = await axe(node, axeDefaults); // runs only WCAG 2.2 AA rules
// The same defaults spelled out: the rule tags and the impacts that fail a test.
export const defaults = { tags: WCAG_22_AA_TAGS, failOn: DEFAULT_IMPACT_FAIL_LEVELS };
