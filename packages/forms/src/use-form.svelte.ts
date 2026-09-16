// Pull `superForm` from the `/client` subpath, not the root barrel: the root
// re-exports `SuperDebug.svelte`, which a Node test runner cannot load (no Svelte
// compiler for `.svelte`). `/client` carries the same `superForm` with no
// component import (mirrors the `./server` invariant in AGENTS.md).
import { superForm as upstreamSuperForm } from 'sveltekit-superforms/client';
import type { Readable } from 'svelte/store';
import { mirror } from './store-rune.svelte.js';
import type { FormOptions, SuperForm, SuperValidated } from 'sveltekit-superforms';

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
	readonly constraints: SuperForm<Out>['constraints'] extends Readable<infer C> ? C : never;
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
/**
 * The current value of a store, read synchronously.
 *
 * Subscribing and immediately unsubscribing is the documented way to read a
 * Svelte store outside a component: the callback fires once with the current
 * value before `subscribe` returns. Used to give each rune its initial value so
 * the first render matches the store rather than showing an empty frame until
 * the `$effect` subscriptions land.
 */
/**
 * The members handed straight back from Superforms.
 *
 * `useForm` does two different things to `SuperForm`: nine of its stores are
 * mirrored into runes, and the rest — the actions, the config, the instance
 * itself — pass through untouched. Naming that split makes it visible which
 * members are reactive here and which are simply forwarded.
 *
 * Spreading the result is safe because every member is a plain value or function
 * reference. The reactive members must stay as getters on the returned object,
 * since spreading a getter would evaluate it once and freeze the value.
 */
function passthrough<Out extends Record<string, unknown>, In extends Record<string, unknown>>(
	sf: SuperForm<Out, In>,
) {
	return {
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
	type Constraints = SuperForm<Out>['constraints'] extends Readable<infer C> ? C : never;
	type Tainted = SuperForm<Out>['tainted'] extends Readable<infer T> ? T : never;

	const data = mirror<Data>(sf.form);
	const errors = mirror<Errors>(sf.errors);
	const constraints = mirror<Constraints>(sf.constraints);
	const message = mirror<unknown>(sf.message);
	const tainted = mirror<Tainted>(sf.tainted);
	const submitting = mirror(sf.submitting);
	const delayed = mirror(sf.delayed);
	const timeout = mirror(sf.timeout);
	const allErrors = mirror<FormError[]>(sf.allErrors);

	return {
		get data() {
			return data.current;
		},
		get errors() {
			return errors.current;
		},
		get constraints() {
			return constraints.current;
		},
		get message() {
			return message.current;
		},
		get tainted() {
			return tainted.current;
		},
		get submitting() {
			return submitting.current;
		},
		get delayed() {
			return delayed.current;
		},
		get timeout() {
			return timeout.current;
		},
		get allErrors() {
			return allErrors.current;
		},
		get valid() {
			return allErrors.current.length === 0;
		},
		...passthrough(sf),
	};
}
