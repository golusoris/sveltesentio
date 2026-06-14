// Server-safe subset of @sveltesentio/forms — re-exports only the server action
// helpers from `sveltekit-superforms/server`, so a non-SvelteKit / server-only
// consumer can `superValidate` without pulling client `superForm`/proxies and the
// `$app/*` virtual modules the main barrel statically imports.
export { superValidate } from './super-validate.js';
export type { ZodV4Schema } from './super-validate.js';

export { problemToFieldErrors } from './problem-to-field-errors.js';
export type { FieldErrors } from './problem-to-field-errors.js';

export {
	message,
	setError,
	setMessage,
	actionResult,
	defaults,
	defaultValues,
	withFiles,
	removeFiles,
} from 'sveltekit-superforms/server';

export type {
	SuperValidated,
	SuperValidateOptions,
	ValidationErrors,
	Infer,
	InferIn,
	Schema,
	InputConstraints,
	JSONSchema,
	ErrorStatus,
} from 'sveltekit-superforms';
