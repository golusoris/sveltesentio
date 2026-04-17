import type { Preset } from './types.js';

export const tenFootPreset = {
  id: 'ten-foot',
  name: '10-foot / TV',
  description: 'Apple TV / Kodi-style UIs. D-pad navigation, enlarged text, TV-safe margins.',
  defaultMode: 'dark',
  primaryHue: 295,
  cssFile: '@sveltesentio/ui/tokens/ten-foot.css',
  minTargetPx: 96,
  bottomNav: false,
  dpadNav: true,
} as const satisfies Preset;
