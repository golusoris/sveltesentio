// Superforms + Zod v4 at the boundary; Problem → field errors out of the box.
import { superValidate, superForm, problemToFieldErrors } from '@sveltesentio/forms';
import { z } from 'zod';

const schema = z.object({ email: z.string().email(), age: z.number().min(18) });

// +page.server.ts
export const load = async () => ({ form: await superValidate(schema) });
// In a server action, map an upstream Problem onto the form:
// return fail(400, { form: problemToFieldErrors(form, problem) });
