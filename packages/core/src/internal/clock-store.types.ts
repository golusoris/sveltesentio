import type { Clock } from '../clock.js';

/**
 * The request-scoped clock store behind `#clock-store`. The package.json
 * `imports` map picks the variant: `browser` has no Node import, `default`
 * holds the `AsyncLocalStorage`. Both variants export one `clockStore` of this
 * type, so a variant that drifts fails `tsc`.
 */
export interface ClockStore {
	/** The clock bound to the current async context, if any. */
	getStore(): Clock | undefined;
	/** Run `fn` with `clock` bound to its async context. */
	run<R>(clock: Clock, fn: () => R): R;
}
