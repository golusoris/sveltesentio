import { ProblemError } from '@sveltesentio/core';
import { problemToFieldErrors } from './problem-to-field-errors.js';
import type { ZodV4Schema } from './super-validate.js';
import type { SuperValidated, SuperValidateOptions } from 'sveltekit-superforms';

/** Minimal shape of a Kit `RequestEvent` consumed by a form action. */
export interface FormActionEvent {
	request: Request;
}

/**
 * `superValidate` seam. Matches the data-first overload of
 * {@link import('./super-validate.js').superValidate} so the real wrapper
 * drops in directly, while tests can inject a stub with no Kit runtime.
 */
export type SuperValidateFn = <Out extends Record<string, unknown>>(
	data: Request | FormData | URLSearchParams | URL | Partial<Out> | null | undefined,
	schema: ZodV4Schema,
	options?: SuperValidateOptions<Out>,
) => Promise<SuperValidated<Out>>;

/**
 * `fail` seam. Structurally compatible with `@sveltejs/kit`'s `fail`, kept as a
 * seam so this module imports no Kit virtual modules and runs under a plain
 * Node test runner.
 */
export type FailFn = <T>(status: number, data: T) => ActionFailure<T>;

/** Result of a `fail(status, data)` call — mirrors Kit's `ActionFailure`. */
export interface ActionFailure<T> {
	readonly status: number;
	readonly data: T;
}

/** Validated form plus the originating event, handed to the action handler. */
export interface FormActionContext<Out extends Record<string, unknown>, Event> {
	readonly form: SuperValidated<Out>;
	readonly event: Event;
}

/** The wrapped per-action business logic. Throw a `ProblemError` to fail. */
export type FormActionHandler<Out extends Record<string, unknown>, Event, R> = (
	ctx: FormActionContext<Out, Event>,
) => R | Promise<R>;

/** Status used when a thrown `ProblemError` carries no `status`. */
const DEFAULT_FAIL_STATUS = 400;

export interface FormActionConfig {
	/** Injected `superValidate`; defaults to the package wrapper at call time. */
	superValidate: SuperValidateFn;
	/** Injected `fail`; defaults to Kit's `fail` in a SvelteKit consumer. */
	fail: FailFn;
}

/**
 * Builds a `+page.server.ts` action from a schema and a handler.
 *
 * The returned action runs `superValidate` on the request, then:
 * - invalid form → `fail(400, { form })` without invoking the handler;
 * - handler throws a {@link ProblemError} → its `invalid-params` are mapped
 *   through {@link problemToFieldErrors} into the Superforms `form.errors`
 *   shape and returned as `fail(status, { form })`;
 * - otherwise → the handler's return value is passed through unchanged.
 *
 * `superValidate` and `fail` are injected so the action is unit-testable with
 * no Kit runtime. In a SvelteKit app, wire the package `superValidate` and
 * Kit's `fail`.
 */
export function formAction<
	Out extends Record<string, unknown>,
	Event extends FormActionEvent,
	R,
>(
	schema: ZodV4Schema,
	handler: FormActionHandler<Out, Event, R>,
	config: FormActionConfig,
): (event: Event) => Promise<R | ActionFailure<{ form: SuperValidated<Out> }>> {
	const { superValidate, fail } = config;
	return async (event) => {
		const form = await superValidate<Out>(event.request, schema);
		if (!form.valid) {
			return fail(DEFAULT_FAIL_STATUS, { form });
		}
		try {
			return await handler({ form, event });
		} catch (error) {
			if (error instanceof ProblemError) {
				applyProblem(form, error);
				return fail(error.status ?? DEFAULT_FAIL_STATUS, { form });
			}
			throw error;
		}
	};
}

/** Writes a `ProblemError`'s mapped field errors onto `form.errors`. */
function applyProblem<Out extends Record<string, unknown>>(
	form: SuperValidated<Out>,
	error: ProblemError,
): void {
	const fieldErrors = problemToFieldErrors(error);
	const errors = form.errors as Record<string, string[]>;
	for (const [name, reasons] of Object.entries(fieldErrors)) {
		const existing = errors[name];
		errors[name] = existing ? existing.concat(reasons) : reasons;
	}
	form.valid = false;
	form.errors = errors;
}
