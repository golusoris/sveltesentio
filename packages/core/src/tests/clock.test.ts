import { describe, it, expect } from 'vitest';
import { systemClock, createTestClock } from '../clock.js';

describe('systemClock', () => {
  it('now() returns a Date close to current time', () => {
    const before = Date.now();
    const d = systemClock.now();
    const after = Date.now();
    expect(d.getTime()).toBeGreaterThanOrEqual(before);
    expect(d.getTime()).toBeLessThanOrEqual(after);
  });

  it('nowMs() returns current epoch ms', () => {
    const before = Date.now();
    const ms = systemClock.nowMs();
    const after = Date.now();
    expect(ms).toBeGreaterThanOrEqual(before);
    expect(ms).toBeLessThanOrEqual(after);
  });

  it('todayISO() returns YYYY-MM-DD format', () => {
    expect(systemClock.todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('createTestClock', () => {
  it('initialises to given date', () => {
    const clock = createTestClock(new Date('2024-01-15T12:00:00Z'));
    expect(clock.todayISO()).toBe('2024-01-15');
  });

  it('advance() moves clock forward', () => {
    const clock = createTestClock(new Date('2024-01-01T00:00:00Z'));
    clock.advance(3600_000); // 1 hour
    expect(clock.nowMs()).toBe(new Date('2024-01-01T01:00:00Z').getTime());
  });

  it('setTime() jumps to specific time', () => {
    const clock = createTestClock(0);
    clock.setTime('2025-06-15T00:00:00Z');
    expect(clock.todayISO()).toBe('2025-06-15');
  });

  it('now() returns a new Date instance each call', () => {
    const clock = createTestClock(1000);
    const a = clock.now();
    const b = clock.now();
    expect(a).not.toBe(b);
    expect(a.getTime()).toBe(b.getTime());
  });
});
