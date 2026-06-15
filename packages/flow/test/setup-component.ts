// Component-test setup (jsdom project only). Registers the jest-dom matchers
// (`toBeInTheDocument`, `toHaveAttribute`, …). After-each unmount is wired by
// the `svelteTesting()` Vite plugin in vitest.config.ts, so it is not repeated
// here.
import '@testing-library/jest-dom/vitest';
