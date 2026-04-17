import type { Preset } from './types.js';

export const dashboardPreset = {
  id: 'dashboard',
  name: 'Dashboard / Admin',
  description: 'Grafana-style dashboards and admin panels with dense data display.',
  defaultMode: 'dark',
  primaryHue: 195,
  cssFile: '@sveltesentio/ui/tokens/dashboard.css',
  minTargetPx: 32,
  bottomNav: false,
  dpadNav: false,
} as const satisfies Preset;
