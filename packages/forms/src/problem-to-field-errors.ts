import type { InvalidParam, ProblemError } from '@sveltesentio/core';

export type FieldErrors = Record<string, string[]>;

export function problemToFieldErrors(error: ProblemError): FieldErrors {
	const out: FieldErrors = {};
	const params: readonly InvalidParam[] = error.invalidParams ?? [];
	for (const param of params) {
		const bucket = out[param.name];
		if (bucket) bucket.push(param.reason);
		else out[param.name] = [param.reason];
	}
	return out;
}
