import { afterEach, describe, expect, it, vi } from 'vitest';
import { dashboardPreset, prefersReducedMotion } from '../src/preset.js';

describe('dashboardPreset', () => {
  it('returns the admin-panel defaults', () => {
    const preset = dashboardPreset();
    expect(preset.padding).toEqual({ top: 8, right: 16, bottom: 28, left: 40 });
    expect(preset.grid).toEqual({ x: true, y: true });
    expect(preset.tooltip).toEqual({ mode: 'bisect-x', snapToDataX: true, snapToDataY: false });
    expect(preset.motion).toEqual({ duration: 300, easing: 'cubicOut' });
  });

  it('collapses motion to zero under reduced-motion', () => {
    const preset = dashboardPreset({ reducedMotion: true });
    expect(preset.motion).toEqual({ duration: 0, easing: 'linear' });
  });

  it('merges partial padding overrides onto the base', () => {
    const preset = dashboardPreset({ padding: { left: 64, top: 0 } });
    expect(preset.padding).toEqual({ top: 0, right: 16, bottom: 28, left: 64 });
  });

  it('does not mutate the shared base padding between calls', () => {
    const a = dashboardPreset({ padding: { left: 100 } });
    const b = dashboardPreset();
    expect(a.padding.left).toBe(100);
    expect(b.padding.left).toBe(40);
  });
});

describe('prefersReducedMotion', () => {
  const original = globalThis.matchMedia;
  afterEach(() => {
    globalThis.matchMedia = original;
  });

  it('returns false when matchMedia is unavailable (SSR)', () => {
    // @ts-expect-error — simulate a server runtime with no matchMedia.
    delete globalThis.matchMedia;
    expect(prefersReducedMotion()).toBe(false);
  });

  it('reflects the media-query match result', () => {
    globalThis.matchMedia = vi.fn((query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof globalThis.matchMedia;
    expect(prefersReducedMotion()).toBe(true);
  });
});
