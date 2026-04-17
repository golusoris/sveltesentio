import type { Preset } from './types.js';

export const webappPreset = {
  id: 'webapp',
  name: 'Standard Web App',
  description: 'SaaS apps, admin forms, CRUD interfaces. shadcn-svelte baseline.',
  defaultMode: 'system',
  primaryHue: 250,
  cssFile: '@sveltesentio/ui/tokens/webapp.css',
  minTargetPx: 44,
  bottomNav: false,
  dpadNav: false,
} as const satisfies Preset;
