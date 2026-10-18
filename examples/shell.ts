// Interface-type classification: desktop / 10-foot / handheld presets.
import { classifyDevice, readDeviceSignals, TENFOOT_MIN_WIDTH } from '@sveltesentio/shell';

const kind = classifyDevice(readDeviceSignals()); // 'desktop' | 'tenfoot' | 'handheld'
// TENFOOT_MIN_WIDTH (1280) is the viewport width the 10-foot preset starts at.
export const wideEnough = window.innerWidth >= TENFOOT_MIN_WIDTH;
if (kind === 'tenfoot') enableSpatialNavigation();
