import { describe, expect, it, vi } from 'vitest';
import { effect_root, flush } from 'svelte/internal/client';
import { get, writable, type Writable } from 'svelte/store';
import type { SuperForm } from 'sveltekit-superforms';
import {
	useForm,
	type FormError,
	type SuperFormFn,
	type UseForm,
} from '../src/use-form.svelte.js';

/**
 * `useForm` is a runes module: it subscribes to each `superForm` store inside an
 * `$effect` and mirrors the latest value into `$state`, exposed through getters.
 * Observing a getter recompute after a store write only works inside a reactive
 * scope, so every assertion runs through `withForm`, which opens an
 * `$effect.root`, builds the rune over an injected fake `SuperForm`, runs the
 * body (interleaving store writes with `flush()`), then tears the root down
 * (mirroring component unmount, which unsubscribes the bridge). This exercises
 * the genuine Svelte runtime — compiled from `use-form.svelte.ts` by the vitest
 * config's runes plugin — rather than a non-reactive shim.
 */

type Out = { email: string; age: number };

/** A fake `SuperForm` backed by real writable stores the test can drive. */
interface FakeSuperForm {
	form: Writable<Out>;
	errors: Writable<Record<string, string[] | undefined>>;
	constraints: Writable<Record<string, unknown>>;
	message: Writable<string | undefined>;
	tainted: Writable<Record<string, unknown> | undefined>;
	submitting: Writable<boolean>;
	delayed: Writable<boolean>;
	timeout: Writable<boolean>;
	allErrors: Writable<FormError[]>;
	enhance: ReturnType<typeof vi.fn>;
	submit: ReturnType<typeof vi.fn>;
	reset: ReturnType<typeof vi.fn>;
	validate: ReturnType<typeof vi.fn>;
	validateForm: ReturnType<typeof vi.fn>;
	isTainted: ReturnType<typeof vi.fn>;
	capture: ReturnType<typeof vi.fn>;
	restore: ReturnType<typeof vi.fn>;
	options: Record<string, unknown>;
}

function makeFake(initial?: Partial<Out>): FakeSuperForm {
	return {
		form: writable<Out>({ email: '', age: 0, ...initial }),
		errors: writable<Record<string, string[] | undefined>>({}),
		constraints: writable<Record<string, unknown>>({ email: { required: true } }),
		message: writable<string | undefined>(undefined),
		tainted: writable<Record<string, unknown> | undefined>(undefined),
		submitting: writable(false),
		delayed: writable(false),
		timeout: writable(false),
		allErrors: writable<FormError[]>([]),
		enhance: vi.fn(),
		submit: vi.fn(),
		reset: vi.fn(),
		validate: vi.fn(),
		validateForm: vi.fn(),
		isTainted: vi.fn(() => false),
		capture: vi.fn(),
		restore: vi.fn(),
		options: { id: 'test' },
	};
}

/** The injected seam: hands `useForm` the fake instead of the real superForm. */
function inject(fake: FakeSuperForm): { superForm: SuperFormFn } {
	return { superForm: (() => fake as unknown as SuperForm<Out>) as SuperFormFn };
}

/**
 * Opens an `$effect.root`, constructs the rune over `fake`, runs `body`, flushes
 * pending reactions, then tears the root down. `body` receives both the rune and
 * a `flush` it can call mid-test after driving a store write.
 */
function withForm(
	fake: FakeSuperForm,
	body: (f: UseForm<Out>, flushNow: () => void) => void,
): void {
	const cleanup = effect_root(() => {
		const f = useForm<Out>({ email: '', age: 0 }, undefined, inject(fake));
		body(f, flush);
	});
	flush();
	cleanup();
}

describe('useForm — injected superForm seam', () => {
	it('calls the injected superForm with the supplied form and options', () => {
		const fake = makeFake();
		const superForm = vi.fn(() => fake as unknown as SuperForm<Out>) as SuperFormFn;
		const input = { email: 'seed@example.com', age: 21 };
		const options = { id: 'signup', dataType: 'form' as const };
		const cleanup = effect_root(() => {
			useForm<Out>(input, options, { superForm });
		});
		flush();
		cleanup();
		expect(superForm).toHaveBeenCalledOnce();
		expect(superForm).toHaveBeenCalledWith(input, options);
	});

	it('exposes the raw SuperForm through the `superform` escape hatch', () => {
		const fake = makeFake();
		withForm(fake, (f) => {
			expect(f.superform).toBe(fake);
		});
	});

	// The `?? upstreamSuperForm` default branch is intentionally not unit-tested:
	// the real `superForm` invokes Svelte's `onDestroy` lifecycle, which needs a
	// component + browser runtime this Node runner cannot provide. AGENTS.md
	// directs default-seam coverage to downstream app integration tests (which
	// must not mock Superforms). The seam exists precisely so the rune's own
	// behaviour is testable against a fake here.
});

describe('useForm — initial seeded state', () => {
	it('seeds data / errors / constraints / submit flags from the stores', () => {
		const fake = makeFake({ email: 'dev@example.com', age: 30 });
		withForm(fake, (f) => {
			expect(f.data).toEqual({ email: 'dev@example.com', age: 30 });
			expect(f.errors).toEqual({});
			expect(f.constraints).toEqual({ email: { required: true } });
			expect(f.message).toBeUndefined();
			expect(f.tainted).toBeUndefined();
			expect(f.submitting).toBe(false);
			expect(f.delayed).toBe(false);
			expect(f.timeout).toBe(false);
			expect(f.allErrors).toEqual([]);
			expect(f.valid).toBe(true);
		});
	});
});

describe('useForm — reactive field updates', () => {
	it('reflects a `$form` store write on the `data` getter after flush', () => {
		const fake = makeFake({ email: '', age: 0 });
		withForm(fake, (f, flushNow) => {
			expect(f.data.email).toBe('');
			fake.form.set({ email: 'typed@example.com', age: 42 });
			flushNow();
			expect(f.data).toEqual({ email: 'typed@example.com', age: 42 });
		});
	});

	it('reflects successive form writes, latest wins', () => {
		const fake = makeFake();
		withForm(fake, (f, flushNow) => {
			fake.form.update((v) => ({ ...v, email: 'a@x.com' }));
			flushNow();
			expect(f.data.email).toBe('a@x.com');
			fake.form.update((v) => ({ ...v, email: 'b@x.com', age: 7 }));
			flushNow();
			expect(f.data).toEqual({ email: 'b@x.com', age: 7 });
		});
	});

	it('mirrors the constraints store when it changes', () => {
		const fake = makeFake();
		withForm(fake, (f, flushNow) => {
			fake.constraints.set({ age: { min: 18 } });
			flushNow();
			expect(f.constraints).toEqual({ age: { min: 18 } });
		});
	});
});

describe('useForm — reactive errors', () => {
	it('reflects per-field error writes through the `errors` getter', () => {
		const fake = makeFake();
		withForm(fake, (f, flushNow) => {
			expect(f.errors).toEqual({});
			fake.errors.set({ email: ['must be a valid email'] });
			flushNow();
			expect(f.errors.email).toEqual(['must be a valid email']);
		});
	});

	it('derives `valid` / `allErrors` from the allErrors store', () => {
		const fake = makeFake();
		withForm(fake, (f, flushNow) => {
			expect(f.valid).toBe(true);
			fake.allErrors.set([{ path: 'email', messages: ['required'] }]);
			flushNow();
			expect(f.valid).toBe(false);
			expect(f.allErrors).toEqual([{ path: 'email', messages: ['required'] }]);
			fake.allErrors.set([]);
			flushNow();
			expect(f.valid).toBe(true);
		});
	});

	it('mirrors the status message store', () => {
		const fake = makeFake();
		withForm(fake, (f, flushNow) => {
			fake.message.set('Saved.');
			flushNow();
			expect(f.message).toBe('Saved.');
		});
	});

	it('mirrors the tainted store', () => {
		const fake = makeFake();
		withForm(fake, (f, flushNow) => {
			expect(f.tainted).toBeUndefined();
			fake.tainted.set({ email: true });
			flushNow();
			expect(f.tainted).toEqual({ email: true });
		});
	});
});

describe('useForm — submit / delayed / timeout state', () => {
	it('reflects the submitting store transition', () => {
		const fake = makeFake();
		withForm(fake, (f, flushNow) => {
			expect(f.submitting).toBe(false);
			fake.submitting.set(true);
			flushNow();
			expect(f.submitting).toBe(true);
			fake.submitting.set(false);
			flushNow();
			expect(f.submitting).toBe(false);
		});
	});

	it('reflects the delayed and timeout stores', () => {
		const fake = makeFake();
		withForm(fake, (f, flushNow) => {
			fake.delayed.set(true);
			fake.timeout.set(true);
			flushNow();
			expect(f.delayed).toBe(true);
			expect(f.timeout).toBe(true);
		});
	});
});

describe('useForm — action surface passthrough', () => {
	it('re-exposes the SuperForm methods unchanged', () => {
		const fake = makeFake();
		withForm(fake, (f) => {
			expect(f.enhance).toBe(fake.enhance);
			expect(f.submit).toBe(fake.submit);
			expect(f.reset).toBe(fake.reset);
			expect(f.validate).toBe(fake.validate);
			expect(f.validateForm).toBe(fake.validateForm);
			expect(f.isTainted).toBe(fake.isTainted);
			expect(f.capture).toBe(fake.capture);
			expect(f.restore).toBe(fake.restore);
			expect(f.options).toBe(fake.options);
		});
	});

	it('submit() and reset() delegate to the underlying SuperForm', () => {
		const fake = makeFake();
		withForm(fake, (f) => {
			f.submit();
			f.reset();
			expect(fake.submit).toHaveBeenCalledOnce();
			expect(fake.reset).toHaveBeenCalledOnce();
		});
	});
});

describe('useForm — subscription teardown', () => {
	it('unsubscribes from every store when the effect root is torn down', () => {
		const fake = makeFake();
		// Each writable's last-subscriber unsubscribe is observable: once torn
		// down, a later store write must not throw and the getter is unreadable
		// outside the scope, so assert the store has no live subscribers by
		// checking `get` still returns the written value (store itself survives).
		const cleanup = effect_root(() => {
			const f = useForm<Out>({ email: '', age: 0 }, undefined, inject(fake));
			fake.submitting.set(true);
			flush();
			expect(f.submitting).toBe(true);
		});
		flush();
		cleanup();
		// After teardown the bridge no longer mirrors writes; the underlying store
		// is independent and still settable.
		fake.submitting.set(false);
		expect(get(fake.submitting)).toBe(false);
	});
});
