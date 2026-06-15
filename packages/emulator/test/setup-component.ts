// Component-lane setup (jsdom project only). Registers the jest-dom matchers
// (`toBeInTheDocument`, `toHaveAttribute`, …) and tears down rendered
// components between cases so jsdom does not accumulate detached DOM (the
// `<Emulator>` `$effect` cleanup also clears the `EJS_*` globals it set, so an
// explicit unmount between tests keeps the shared window bag clean).
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/svelte';
import { afterEach } from 'vitest';

afterEach(() => {
	cleanup();
});
