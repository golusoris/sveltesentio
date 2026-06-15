// Component-lane setup: registers jest-dom matchers (toBeInTheDocument,
// toHaveAttribute, …) and tears down rendered components between tests so
// jsdom does not accumulate detached DOM across cases.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/svelte';
import { afterEach } from 'vitest';

// jsdom ships no `matchMedia`; Svelte's `prefers-reduced-motion` media query
// (used by LayerChart's tweened motion) reads it at import time. Provide a
// non-matching stub so charts render their non-reduced default under test.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
	window.matchMedia = (query: string): MediaQueryList =>
		({
			matches: false,
			media: query,
			onchange: null,
			addListener: () => {},
			removeListener: () => {},
			addEventListener: () => {},
			removeEventListener: () => {},
			dispatchEvent: () => false,
		}) as MediaQueryList;
}

// jsdom has no `ResizeObserver`; LayerChart's responsive `Chart` container
// observes its own size. A no-op stub keeps charts mountable under test (the
// SVG renders at zero size, which is fine — we assert structure / a11y, not px).
if (typeof globalThis.ResizeObserver === 'undefined') {
	globalThis.ResizeObserver = class {
		observe(): void {}
		unobserve(): void {}
		disconnect(): void {}
	};
}

afterEach(() => {
	cleanup();
});
