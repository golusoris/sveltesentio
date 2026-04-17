export type { ColorMode, InterfaceType, Preset } from './types.js';

export { mediaPreset } from './media.js';
export { dashboardPreset } from './dashboard.js';
export { webappPreset } from './webapp.js';
export { pwaPreset } from './pwa.js';
export { tenFootPreset } from './ten-foot.js';
export { flowPreset } from './flow.js';

import type { Preset } from './types.js';
import { mediaPreset } from './media.js';
import { dashboardPreset } from './dashboard.js';
import { webappPreset } from './webapp.js';
import { pwaPreset } from './pwa.js';
import { tenFootPreset } from './ten-foot.js';
import { flowPreset } from './flow.js';

export const presets = {
  media: mediaPreset,
  dashboard: dashboardPreset,
  webapp: webappPreset,
  pwa: pwaPreset,
  'ten-foot': tenFootPreset,
  flow: flowPreset,
} as const satisfies Record<string, Preset>;

export type PresetId = keyof typeof presets;
