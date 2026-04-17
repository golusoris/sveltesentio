import { describe, it, expect } from 'vitest';
import {
  mediaPreset,
  dashboardPreset,
  webappPreset,
  pwaPreset,
  tenFootPreset,
  flowPreset,
  presets,
} from '../presets/index.js';
import { tokenPaths } from '../tokens/index.js';
import type { Preset } from '../presets/types.js';

const allPresets = [
  mediaPreset,
  dashboardPreset,
  webappPreset,
  pwaPreset,
  tenFootPreset,
  flowPreset,
];

describe('preset shape', () => {
  for (const preset of allPresets) {
    it(`${preset.id} — has all required fields`, () => {
      const p: Preset = preset;
      expect(typeof p.id).toBe('string');
      expect(typeof p.name).toBe('string');
      expect(typeof p.description).toBe('string');
      expect(['dark', 'light', 'system']).toContain(p.defaultMode);
      expect(typeof p.primaryHue).toBe('number');
      expect(p.primaryHue).toBeGreaterThanOrEqual(0);
      expect(p.primaryHue).toBeLessThan(360);
      expect(p.cssFile).toMatch(/^@sveltesentio\/ui\/tokens\/.+\.css$/);
      expect(typeof p.minTargetPx).toBe('number');
      expect(p.minTargetPx).toBeGreaterThan(0);
      expect(typeof p.bottomNav).toBe('boolean');
      expect(typeof p.dpadNav).toBe('boolean');
    });
  }
});

describe('preset defaults', () => {
  it('media and dashboard are dark by default', () => {
    expect(mediaPreset.defaultMode).toBe('dark');
    expect(dashboardPreset.defaultMode).toBe('dark');
  });

  it('webapp and pwa respect system preference', () => {
    expect(webappPreset.defaultMode).toBe('system');
    expect(pwaPreset.defaultMode).toBe('system');
  });

  it('ten-foot and flow are always dark', () => {
    expect(tenFootPreset.defaultMode).toBe('dark');
    expect(flowPreset.defaultMode).toBe('dark');
  });

  it('only pwa has bottom navigation', () => {
    const withBottomNav = allPresets.filter((p) => p.bottomNav);
    expect(withBottomNav).toHaveLength(1);
    expect(withBottomNav[0]?.id).toBe('pwa');
  });

  it('only ten-foot has D-pad navigation', () => {
    const withDpad = allPresets.filter((p) => p.dpadNav);
    expect(withDpad).toHaveLength(1);
    expect(withDpad[0]?.id).toBe('ten-foot');
  });

  it('ten-foot has largest min target', () => {
    const maxTarget = Math.max(...allPresets.map((p) => p.minTargetPx));
    expect(tenFootPreset.minTargetPx).toBe(maxTarget);
  });

  it('pwa meets Apple HIG 48px min touch target', () => {
    expect(pwaPreset.minTargetPx).toBeGreaterThanOrEqual(48);
  });
});

describe('presets registry', () => {
  it('contains all 6 presets', () => {
    expect(Object.keys(presets)).toHaveLength(6);
  });

  it('keys match preset ids', () => {
    for (const [key, preset] of Object.entries(presets)) {
      expect(preset.id).toBe(key);
    }
  });
});

describe('tokenPaths', () => {
  it('all paths are @sveltesentio/ui scoped', () => {
    for (const path of Object.values(tokenPaths)) {
      expect(path).toMatch(/^@sveltesentio\/ui\/tokens\//);
    }
  });

  it('has a path for each preset plus base', () => {
    expect(tokenPaths.base).toBeDefined();
    expect(tokenPaths.media).toBeDefined();
    expect(tokenPaths.dashboard).toBeDefined();
    expect(tokenPaths.webapp).toBeDefined();
    expect(tokenPaths.pwa).toBeDefined();
    expect(tokenPaths.tenFoot).toBeDefined();
    expect(tokenPaths.flow).toBeDefined();
  });

  it('preset cssFile matches tokenPaths entry', () => {
    expect(mediaPreset.cssFile).toBe(tokenPaths.media);
    expect(dashboardPreset.cssFile).toBe(tokenPaths.dashboard);
    expect(webappPreset.cssFile).toBe(tokenPaths.webapp);
    expect(pwaPreset.cssFile).toBe(tokenPaths.pwa);
    expect(tenFootPreset.cssFile).toBe(tokenPaths.tenFoot);
    expect(flowPreset.cssFile).toBe(tokenPaths.flow);
  });
});
