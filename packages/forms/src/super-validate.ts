import { zod4 as zod4Adapter } from 'sveltekit-superforms/adapters';
import { superValidate as upstreamSuperValidate } from 'sveltekit-superforms/server';
import type {
	SuperValidated,
	SuperValidateOptions,
} from 'sveltekit-superforms';
import type { RequestEvent } from '@sveltejs/kit';

export type ZodV4Schema = Parameters<typeof zod4Adapter>[0];

type AdapterFor<S extends ZodV4Schema> = ReturnType<typeof zod4Adapter<S>>;
type OutOf<S extends ZodV4Schema> = AdapterFor<S> extends {
	defaults: infer D extends Record<string, unknown>;
}
	? D
	: Record<string, unknown>;

type ValidateData<In extends Record<string, unknown>> =
	| RequestEvent
	| Request
	| FormData
	| URLSearchParams
	| URL
	| Partial<In>
	| null
	| undefined;

type CallArgs = readonly [unknown, ...unknown[]];

export async function superValidate<S extends ZodV4Schema>(
	schema: S,
	options?: SuperValidateOptions<OutOf<S>>,
): Promise<SuperValidated<OutOf<S>>>;
export async function superValidate<S extends ZodV4Schema>(
	data: ValidateData<OutOf<S>>,
	schema: S,
	options?: SuperValidateOptions<OutOf<S>>,
): Promise<SuperValidated<OutOf<S>>>;
export async function superValidate(
	...args: CallArgs
): Promise<SuperValidated<Record<string, unknown>>> {
	const [first, second, third] = args;
	const schemaFirst = isSchema(first);
	const schema = (schemaFirst ? first : second) as ZodV4Schema;
	const adapter = zod4Adapter(schema);
	const call = upstreamSuperValidate as unknown as (
		...forwarded: unknown[]
	) => Promise<SuperValidated<Record<string, unknown>>>;
	if (schemaFirst) {
		return call(adapter, second);
	}
	return call(first, adapter, third);
}

function isSchema(value: unknown): value is ZodV4Schema {
	return (
		typeof value === 'object' &&
		value !== null &&
		'_zod' in (value as Record<string, unknown>)
	);
}
