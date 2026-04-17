import type { Preset } from './types.js';

export const pwaPreset = {
  id: 'pwa',
  name: 'Mobile PWA',
  description: 'Installable PWAs with touch-optimized spacing and bottom navigation.',
  defaultMode: 'system',
  primaryHue: 250,
  cssFile: '@sveltesentio/ui/tokens/pwa.css',
  minTargetPx: 48,
  bottomNav: true,
  dpadNav: false,
} as const satisfies Preset;
