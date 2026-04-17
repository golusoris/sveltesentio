export interface Clock {
  /** Current time as a Date object. */
  now(): Date;
  /** Current Unix timestamp in milliseconds. */
  nowMs(): number;
  /** Current date string in ISO 8601 format (YYYY-MM-DD), in UTC. */
  todayISO(): string;
}

export const systemClock: Clock = {
  now: () => new Date(),
  nowMs: () => Date.now(),
  todayISO: () => new Date().toISOString().slice(0, 10),
};

export interface TestClock extends Clock {
  /** Advance the clock by the given number of milliseconds. */
  advance(ms: number): void;
  /** Set the clock to a specific time. */
  setTime(time: Date | string | number): void;
}

export function createTestClock(initial: Date | string | number = 0): TestClock {
  let current = new Date(initial);

  return {
    now: () => new Date(current),
    nowMs: () => current.getTime(),
    todayISO: () => current.toISOString().slice(0, 10),
    advance(ms: number): void {
      current = new Date(current.getTime() + ms);
    },
    setTime(time: Date | string | number): void {
      current = new Date(time);
    },
  };
}
