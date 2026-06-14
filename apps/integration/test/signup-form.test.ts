import { describe, it, expect } from 'vitest';
import { ProblemError } from '@sveltesentio/core';
import {
	signupSchema,
	emptySignupForm,
	validateSignup,
	signupFieldErrors,
} from '../src/signup-form.js';

describe('forms superValidate + zod v4 composition', () => {
	it('produces an empty, invalid form from defaults', async () => {
		const form = await emptySignupForm();
		expect(form.valid).toBe(false);
		// Defaults: empty string + zero, present on the form data object.
		expect(form.data).toMatchObject({ email: '', password: '', age: 0 });
	});

	it('validates well-formed submitted data', async () => {
		const form = await validateSignup({
			email: 'user@example.com',
			password: 'hunter2hunter2',
			age: 21,
		});
		expect(form.valid).toBe(true);
		expect(form.data.email).toBe('user@example.com');
	});

	it('reports per-field zod errors on bad input', async () => {
		const form = await validateSignup({ email: 'nope', password: 'short', age: 12 });
		expect(form.valid).toBe(false);
		expect(form.errors.email).toBeDefined();
		expect(form.errors.password).toBeDefined();
		expect(form.errors.age).toBeDefined();
	});

	it('the raw zod schema agrees with the wrapper', () => {
		expect(signupSchema.safeParse({ email: 'a@b.co', password: '12345678', age: 18 }).success).toBe(
			true,
		);
		expect(signupSchema.safeParse({ email: 'x', password: '1', age: 1 }).success).toBe(false);
	});

	it('maps a server ProblemError onto field errors (RFC 9457 bridge)', () => {
		const problem = new ProblemError({
			type: 'https://err/validation',
			title: 'Validation failed',
			status: 422,
			invalidParams: [
				{ name: 'email', reason: 'already registered' },
				{ name: 'password', reason: 'breached password' },
			],
		});
		const fieldErrors = signupFieldErrors(problem);
		expect(fieldErrors.email).toEqual(['already registered']);
		expect(fieldErrors.password).toEqual(['breached password']);
	});
});
