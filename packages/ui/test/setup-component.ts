// Component-lane setup (jsdom project only). Registers the jest-dom matchers
// (`toBeInTheDocument`, `toHaveAttribute`, …). After-each unmount is wired by the
// `svelteTesting()` Vite plugin in vitest.config.ts, so it is not repeated here.
//
// jsdom ships no `ResizeObserver` and reports `clientHeight === 0` for every
// element (no layout engine). `VirtualList` drives its window from a
// `bind:clientHeight` viewport, so two shims are installed:
//
//   1. A functional `ResizeObserver` that remembers its observed targets; the
//      `resize-observer-stub` module exposes `flushResizeObservers()` so a test
//      can re-fire Svelte's size listener after it has set a height.
//   2. A configurable `clientHeight` / `clientWidth` getter on `HTMLElement`
//      reading an opt-in `__stubClientHeight` / `__stubClientWidth` instance
//      field — see `resize-observer-stub.setClientHeight`.
import '@testing-library/jest-dom/vitest';
import { installResizeObserverStub } from './resize-observer-stub.js';

installResizeObserverStub();
