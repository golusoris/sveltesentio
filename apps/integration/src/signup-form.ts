/**
 * Forms composition: a Zod v4 schema validated through `@sveltesentio/forms`
 * `superValidate`, with RFC 9457 problem documents mapped onto field errors via
 * `problemToFieldErrors`. Proves the forms wrapper accepts a real zod/v4 schema
 * and that the problem -> field-error bridge composes with `@sveltesentio/core`.
 */
import { z } from 'zod';
import { superValidate, problemToFieldErrors } from '@sveltesentio/forms';
import type { SuperValidated, FieldErrors } from '@sveltesentio/forms';
import type { ProblemError } from '@sveltesentio/core';

/** Zod v4 schema for the demo signup form. */
export const signupSchema = z.object({
	email: z.email(),
	password: z.string().min(8, 'Password must be at least 8 characters'),
	age: z.number().int().min(18, 'Must be 18 or older'),
});

/** Inferred output type the form binds to. */
export type SignupInput = z.infer<typeof signupSchema>;

/** Validate empty defaults — the shape a GET load returns to seed the form. */
export function emptySignupForm(): Promise<SuperValidated<SignupInput>> {
	return superValidate(signupSchema);
}

/** Validate submitted data (FormData / object) against the schema. */
export function validateSignup(
	data: FormData | Partial<SignupInput>,
): Promise<SuperValidated<SignupInput>> {
	return superValidate(data, signupSchema);
}

/**
 * Map a server-thrown RFC 9457 `ProblemError` (carrying `invalid-params`) onto
 * per-field errors so the form can surface server-side validation failures
 * alongside the client-side zod errors.
 */
export function signupFieldErrors(error: ProblemError): FieldErrors {
	return problemToFieldErrors(error);
}
