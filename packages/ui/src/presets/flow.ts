import type { Preset } from './types.js';

export const flowPreset = {
  id: 'flow',
  name: 'Flow Editor',
  description: 'Node-based flow editors and DAG UIs (@xyflow/svelte, n8n-style).',
  defaultMode: 'dark',
  primaryHue: 230,
  cssFile: '@sveltesentio/ui/tokens/flow.css',
  minTargetPx: 36,
  bottomNav: false,
  dpadNav: false,
} as const satisfies Preset;
