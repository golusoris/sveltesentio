// Shared test kit: deterministic clock + axe-core WCAG 2.2 AA defaults.
import {
  testClock,
  axeDefaults,
  WCAG_22_AA_TAGS,
  DEFAULT_IMPACT_FAIL_LEVELS,
} from '@sveltesentio/testing';
import { setClock } from '@sveltesentio/core';

setClock(testClock(0)); // freeze time for stable snapshots
const results = await axe(node, axeDefaults); // runs only WCAG 2.2 AA rules
