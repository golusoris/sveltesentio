// Deterministic, injectable time — never call Date.now() directly (§ no-direct-time).
import { setClock, getClock, systemClock, createHydrationClock } from '@sveltesentio/core';

// Production: wall clock. Tests: inject a fixed clock so snapshots are stable.
setClock(systemClock);
const now = getClock().now(); // -> epoch ms from the active clock

// SSR→CSR without a hydration flash: freeze server time, resume on the client.
export const clock = createHydrationClock();
