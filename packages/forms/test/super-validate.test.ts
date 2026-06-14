import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { superValidate } from '../src/super-validate.js';

const schema = z.object({
	email: z.email(),
	age: z.number().int().min(18),
});

describe('superValidate', () => {
	it('returns defaults when called with schema alone', async () => {
		const form = await superValidate(schema);
		expect(form.valid).toBe(false);
		expect(form.errors).toEqual({});
		expect(form.data).toEqual({ email: '', age: 0 });
	});

	it('validates FormData and surfaces per-field errors', async () => {
		const fd = new FormData();
		fd.set('email', 'not-an-email');
		fd.set('age', '12');
		const form = await superValidate(fd, schema);
		expect(form.valid).toBe(false);
		expect(form.errors.email).toBeDefined();
		expect(form.errors.age).toBeDefined();
	});

	it('reports valid=true when FormData parses cleanly', async () => {
		const fd = new FormData();
		fd.set('email', 'dev@example.com');
		fd.set('age', '30');
		const form = await superValidate(fd, schema);
		expect(form.valid).toBe(true);
		expect(form.data).toEqual({ email: 'dev@example.com', age: 30 });
		expect(form.errors).toEqual({});
	});
});
