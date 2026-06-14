// @sveltesentio/shell — device-class layout + input primitives.
// See ADR-0027 (focus graph) · ADR-0028 (PWA) · ADR-0029 (safe-area).

export {
	type DeviceClass,
	type DeviceSignals,
	TENFOOT_MIN_WIDTH,
	HANDHELD_MAX_WIDTH,
	classifyDevice,
	readDeviceSignals,
} from './device-class.js';

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

export {
	type SafeAreaSide,
	type SafeAreaLogicalEdge,
	SAFE_AREA_SIDES,
	safeAreaInset,
	safeAreaVarName,
	cssVars,
	cssVarsString,
	safeAreaPadding,
} from './safe-area.js';

export {
	type RegisterSWOptions,
	type UpdateServiceWorker,
	registerSW,
} from './pwa.js';
