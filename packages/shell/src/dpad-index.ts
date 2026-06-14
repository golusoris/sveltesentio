// Public barrel for the `@sveltesentio/shell/dpad` sub-export: pure focus-graph
// geometry/input mapping plus the Svelte navigation action.

export {
	type Direction,
	type FocusRect,
	type FocusCandidate,
	type FocusGraphSource,
	computeNextFocus,
	directionFromKey,
	directionFromGamepadButton,
	directionFromAxes,
	resolveNextFocus,
} from './dpad.js';

export { type DpadNavigationOptions, dpadNavigation } from './dpad-action.js';
