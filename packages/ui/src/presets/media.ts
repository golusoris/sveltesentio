import type { Preset } from './types.js';

export const mediaPreset = {
  id: 'media',
  name: 'Media Server',
  description: 'Jellyfin/Navidrome-style web UIs with artwork grids and playback bar.',
  defaultMode: 'dark',
  primaryHue: 295,
  cssFile: '@sveltesentio/ui/tokens/media.css',
  minTargetPx: 40,
  bottomNav: false,
  dpadNav: false,
} as const satisfies Preset;
