// Component-lane setup: registers jest-dom matchers (toBeInTheDocument,
// toHaveAttribute, …) and tears down rendered components between tests so
// jsdom does not accumulate detached DOM across tests.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/svelte';
import { afterEach } from 'vitest';

afterEach(() => {
	cleanup();
});
