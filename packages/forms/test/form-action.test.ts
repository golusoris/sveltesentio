import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ProblemError } from '@sveltesentio/core';
import type { SuperValidated } from 'sveltekit-superforms';
import {
	formAction,
	type ActionFailure,
	type FormActionConfig,
	type SuperValidateFn,
} from '../src/form-action.js';

type Out = { email: string; age: number };
type FailData = { form: SuperValidated<Out> };

const schema = z.object({ email: z.email(), age: z.number().int() });

function makeForm(valid: boolean, data: Out): SuperValidated<Out> {
	return {
		id: 'test',
		valid,
		posted: true,
		errors: {},
		data,
	} as SuperValidated<Out>;
}

type FailSpy = ReturnType<
	typeof vi.fn<(status: number, data: unknown) => ActionFailure<unknown>>
>;

/** Builds a config whose `superValidate` always returns the given form. */
function config(form: SuperValidated<Out>): FormActionConfig & { fail: FailSpy } {
	const superValidate = vi.fn(async () => form) as unknown as SuperValidateFn;
	const fail: FailSpy = vi.fn((status: number, data: unknown) => ({ status, data }));
	return { superValidate, fail: fail as FormActionConfig['fail'] & FailSpy };
}

const event = { request: new Request('http://localhost/', { method: 'POST' }) };

describe('formAction', () => {
	it('runs the handler and passes its result through on a valid submit', async () => {
		const form = makeForm(true, { email: 'dev@example.com', age: 30 });
		const cfg = config(form);
		let received: SuperValidated<Out> | undefined;
		const handler = vi.fn(async (ctx: { form: SuperValidated<Out> }) => {
			received = ctx.form;
			return { ok: true } as const;
		});

		const action = formAction<Out, typeof event, { ok: true }>(schema, handler, cfg);
		const result = await action(event);

		expect(handler).toHaveBeenCalledOnce();
		expect(received).toBe(form);
		expect(cfg.fail).not.toHaveBeenCalled();
		expect(result).toEqual({ ok: true });
	});

	it('fails without running the handler when the form is invalid', async () => {
		const form = makeForm(false, { email: '', age: 0 });
		const cfg = config(form);
		const handler = vi.fn(async () => ({ ok: true } as const));

		const action = formAction<Out, typeof event, { ok: true }>(schema, handler, cfg);
		const result = (await action(event)) as ActionFailure<FailData>;

		expect(handler).not.toHaveBeenCalled();
		expect(cfg.fail).toHaveBeenCalledWith(400, { form });
		expect(result.status).toBe(400);
		expect(result.data.form).toBe(form);
	});

	it('maps a thrown ProblemError into field errors and fails with its status', async () => {
		const form = makeForm(true, { email: 'taken@example.com', age: 30 });
		const cfg = config(form);
		const handler = vi.fn(async () => {
			throw new ProblemError({
				type: 'https://example.com/validation',
				status: 422,
				invalidParams: [
					{ name: 'email', reason: 'already registered' },
					{ name: 'email', reason: 'must be a work address' },
				],
			});
		});

		const action = formAction<Out, typeof event, never>(schema, handler, cfg);
		const result = (await action(event)) as ActionFailure<FailData>;

		expect(cfg.fail).toHaveBeenCalledOnce();
		expect(result.status).toBe(422);
		expect(result.data.form.valid).toBe(false);
		expect(result.data.form.errors).toEqual({
			email: ['already registered', 'must be a work address'],
		});
	});

	it('merges mapped errors onto any errors already present on the form', async () => {
		const form = makeForm(true, { email: 'x@example.com', age: 30 });
		(form.errors as Record<string, string[]>).email = ['pre-existing'];
		const cfg = config(form);
		const handler = vi.fn(async () => {
			throw new ProblemError({
				type: 'about:blank',
				status: 409,
				invalidParams: [{ name: 'email', reason: 'conflict' }],
			});
		});

		const action = formAction<Out, typeof event, never>(schema, handler, cfg);
		const result = (await action(event)) as ActionFailure<FailData>;

		expect(result.status).toBe(409);
		expect(result.data.form.errors).toEqual({ email: ['pre-existing', 'conflict'] });
	});

	it('defaults the fail status to 400 when the ProblemError carries none', async () => {
		const form = makeForm(true, { email: 'x@example.com', age: 30 });
		const cfg = config(form);
		const handler = vi.fn(async () => {
			throw new ProblemError({
				type: 'about:blank',
				invalidParams: [{ name: 'age', reason: 'too young' }],
			});
		});

		const action = formAction<Out, typeof event, never>(schema, handler, cfg);
		const result = (await action(event)) as ActionFailure<FailData>;

		expect(result.status).toBe(400);
		expect(result.data.form.errors).toEqual({ age: ['too young'] });
	});

	it('rethrows non-ProblemError throwables unchanged', async () => {
		const form = makeForm(true, { email: 'x@example.com', age: 30 });
		const cfg = config(form);
		const boom = new Error('database is down');
		const handler = vi.fn(async () => {
			throw boom;
		});

		const action = formAction<Out, typeof event, never>(schema, handler, cfg);
		await expect(action(event)).rejects.toBe(boom);
		expect(cfg.fail).not.toHaveBeenCalled();
	});
});
