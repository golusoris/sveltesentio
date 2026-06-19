// Pull `superForm` from the `/client` subpath, not the root barrel: the root
// re-exports `SuperDebug.svelte`, which a Node test runner cannot load (no Svelte
// compiler for `.svelte`). `/client` carries the same `superForm` with no
// component import (mirrors the `./server` invariant in AGENTS.md).
import { superForm as upstreamSuperForm } from 'sveltekit-superforms/client';
import type { Readable } from 'svelte/store';
import type {
	FormOptions,
	SuperForm,
	SuperValidated,
} from 'sveltekit-superforms';

/**
 * Initial form argument accepted by {@link useForm} — the same shape
 * `superForm` takes: a `SuperValidated` (usually `data.form` from a load) or a
 * plain defaults object.
 */
export type UseFormInput<
	Out extends Record<string, unknown>,
	In extends Record<string, unknown> = Out,
> = SuperValidated<Out, unknown, In> | Out;

/**
 * The `superForm` seam. Structurally compatible with the upstream
 * `superForm(form, options?)`, kept injectable so {@link useForm} unit-tests
 * against a fake `SuperForm` without the Superforms client runtime (which
 * statically imports `$app/*`).
 */
export type SuperFormFn = <
	Out extends Record<string, unknown>,
	In extends Record<string, unknown> = Out,
>(
	form: UseFormInput<Out, In>,
	options?: FormOptions<Out, unknown, In>,
) => SuperForm<Out>;

/** Per-call config for {@link useForm}; `superForm` defaults to upstream. */
export interface UseFormConfig {
	/** Injected `superForm`; defaults to `sveltekit-superforms`' `superForm`. */
	superForm?: SuperFormFn;
}

/** One aggregated error, mirroring `SuperForm.allErrors` entries. */
export interface FormError {
	readonly path: string;
	readonly messages: string[];
}

/**
 * Runes-native view over a {@link SuperForm}. Every Svelte store on the
 * `SuperForm` (`form`, `errors`, `constraints`, `message`, `tainted`,
 * `submitting`, `delayed`, `timeout`, `allErrors`) is mirrored into reactive
 * `$state` and surfaced as a getter, so templates read `f.data.email` /
 * `f.errors.email` / `f.submitting` directly instead of threading `$store`
 * auto-subscriptions. The action surface (`enhance`, `submit`, `reset`, …) is
 * re-exposed unchanged.
 */
export interface UseForm<
	Out extends Record<string, unknown>,
	In extends Record<string, unknown> = Out,
> {
	/** Reactive form values (the `$form` store, runes-native). */
	readonly data: Out;
	/** Reactive per-field errors (the `$errors` store, runes-native). */
	readonly errors: SuperForm<Out>['errors'] extends Readable<infer E> ? E : never;
	/** Reactive input constraints (the `$constraints` store). */
	readonly constraints: SuperForm<Out>['constraints'] extends Readable<infer C>
		? C
		: never;
	/** Reactive status message (the `$message` store), or `undefined`. */
	readonly message: unknown;
	/** Reactive tainted-fields map (the `$tainted` store), or `undefined`. */
	readonly tainted: SuperForm<Out>['tainted'] extends Readable<infer T> ? T : never;
	/** `true` while a submission is in flight (the `$submitting` store). */
	readonly submitting: boolean;
	/** `true` once a submission has passed the `delayMs` threshold. */
	readonly delayed: boolean;
	/** `true` once a submission has passed the `timeoutMs` threshold. */
	readonly timeout: boolean;
	/** Flattened list of every active error (the `$allErrors` store). */
	readonly allErrors: FormError[];
	/** `true` when there are no active errors. */
	readonly valid: boolean;
	/** Progressive-enhancement action for the `<form use:enhance>`. */
	readonly enhance: SuperForm<Out>['enhance'];
	/** Programmatically submit the form. */
	readonly submit: SuperForm<Out>['submit'];
	/** Reset the form to its initial (or supplied) data. */
	readonly reset: SuperForm<Out>['reset'];
	/** Validate a single field path. */
	readonly validate: SuperForm<Out>['validate'];
	/** Validate the whole form. */
	readonly validateForm: SuperForm<Out>['validateForm'];
	/** Tainted-state predicate for a path / the whole form. */
	readonly isTainted: SuperForm<Out>['isTainted'];
	/** Capture the form snapshot (SvelteKit snapshot integration). */
	readonly capture: SuperForm<Out>['capture'];
	/** Restore a captured form snapshot. */
	readonly restore: SuperForm<Out>['restore'];
	/** The resolved Superforms options. */
	readonly options: SuperForm<Out>['options'];
	/** Escape hatch: the underlying {@link SuperForm} (raw stores + methods). */
	readonly superform: SuperForm<Out, In>;
}

/**
 * Runes-native sugar over `superForm`. Call it once at component setup; it
 * subscribes to each Superforms store inside an `$effect` (so the subscriptions
 * are torn down on unmount) and mirrors the latest value into `$state`. Reads
 * happen through getters, so `f.data` / `f.errors` / `f.submitting` are
 * fully reactive without `$`-prefixed auto-subscriptions.
 *
 * ```svelte
 * <script lang="ts">
 *   import { useForm } from '@sveltesentio/forms/use-form';
 *   let { data } = $props();
 *   const f = useForm(data.form);
 * </script>
 * <form method="post" use:f.enhance>
 *   <input name="email" bind:value={f.data.email} aria-invalid={f.errors.email ? 'true' : undefined} />
 *   {#if f.errors.email}<span role="alert">{f.errors.email}</span>{/if}
 *   <button disabled={f.submitting}>Save</button>
 * </form>
 * ```
 *
 * `superForm` is an injected seam (defaults to upstream) so the rune unit-tests
 * against a fake `SuperForm` with no Superforms client runtime.
 */
export function useForm<
	Out extends Record<string, unknown>,
	In extends Record<string, unknown> = Out,
>(
	form: UseFormInput<Out, In>,
	options?: FormOptions<Out, unknown, In>,
	config?: UseFormConfig,
): UseForm<Out, In> {
	const make: SuperFormFn = config?.superForm ?? upstreamSuperForm;
	const sf = make<Out, In>(form, options) as SuperForm<Out, In>;

	type Data = Out;
	type Errors = SuperForm<Out>['errors'] extends Readable<infer E> ? E : never;
	type Constraints = SuperForm<Out>['constraints'] extends Readable<infer C>
		? C
		: never;
	type Tainted = SuperForm<Out>['tainted'] extends Readable<infer T> ? T : never;

	const seed = <T>(store: Readable<T>): T => {
		let captured!: T;
		store.subscribe((value) => {
			captured = value;
		})();
		return captured;
	};

	let data = $state<Data>(seed(sf.form));
	let errors = $state<Errors>(seed(sf.errors));
	let constraints = $state<Constraints>(seed(sf.constraints));
	let message = $state<unknown>(seed(sf.message));
	let tainted = $state<Tainted>(seed(sf.tainted));
	let submitting = $state(seed(sf.submitting));
	let delayed = $state(seed(sf.delayed));
	let timeout = $state(seed(sf.timeout));
	let allErrors = $state<FormError[]>(seed(sf.allErrors));

	$effect(() => {
		const stops = [
			sf.form.subscribe((value) => {
				data = value;
			}),
			sf.errors.subscribe((value) => {
				errors = value;
			}),
			sf.constraints.subscribe((value) => {
				constraints = value;
			}),
			sf.message.subscribe((value) => {
				message = value;
			}),
			sf.tainted.subscribe((value) => {
				tainted = value;
			}),
			sf.submitting.subscribe((value) => {
				submitting = value;
			}),
			sf.delayed.subscribe((value) => {
				delayed = value;
			}),
			sf.timeout.subscribe((value) => {
				timeout = value;
			}),
			sf.allErrors.subscribe((value) => {
				allErrors = value;
			}),
		];
		return () => {
			for (const stop of stops) stop();
		};
	});

	return {
		get data() {
			return data;
		},
		get errors() {
			return errors;
		},
		get constraints() {
			return constraints;
		},
		get message() {
			return message;
		},
		get tainted() {
			return tainted;
		},
		get submitting() {
			return submitting;
		},
		get delayed() {
			return delayed;
		},
		get timeout() {
			return timeout;
		},
		get allErrors() {
			return allErrors;
		},
		get valid() {
			return allErrors.length === 0;
		},
		enhance: sf.enhance,
		submit: sf.submit,
		reset: sf.reset,
		validate: sf.validate,
		validateForm: sf.validateForm,
		isTainted: sf.isTainted,
		capture: sf.capture,
		restore: sf.restore,
		options: sf.options,
		superform: sf,
	};
}
