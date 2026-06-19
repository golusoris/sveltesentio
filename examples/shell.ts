// Interface-type classification: desktop / 10-foot / handheld presets.
import { classifyDevice, readDeviceSignals, TENFOOT_MIN_WIDTH } from '@sveltesentio/shell';

const kind = classifyDevice(readDeviceSignals()); // 'desktop' | 'tenfoot' | 'handheld'
if (kind === 'tenfoot') enableSpatialNavigation();
