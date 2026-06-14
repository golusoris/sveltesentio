import { z } from 'zod';

const invalidParamSchema = z.object({
	name: z.string(),
	reason: z.string(),
});

const problemSchema = z
	.object({
		type: z.string().default('about:blank'),
		title: z.string().optional(),
		status: z.number().int().optional(),
		detail: z.string().optional(),
		instance: z.string().optional(),
		'invalid-params': z.array(invalidParamSchema).optional(),
	})
	.passthrough();

export type InvalidParam = z.infer<typeof invalidParamSchema>;
export type ProblemDocument = z.infer<typeof problemSchema>;

export interface ProblemErrorInit {
	type: string;
	title?: string | undefined;
	status?: number | undefined;
	detail?: string | undefined;
	instance?: string | undefined;
	invalidParams?: readonly InvalidParam[] | undefined;
	extensions?: Readonly<Record<string, unknown>> | undefined;
	cause?: unknown;
}

export class ProblemError extends Error {
	readonly type: string;
	readonly title: string | undefined;
	readonly status: number | undefined;
	readonly detail: string | undefined;
	readonly instance: string | undefined;
	readonly invalidParams: readonly InvalidParam[] | undefined;
	readonly extensions: Readonly<Record<string, unknown>>;

	constructor(init: ProblemErrorInit) {
		const message =
			init.detail ?? init.title ?? `Problem: ${init.type} (${init.status ?? '?'})`;
		super(message, init.cause === undefined ? undefined : { cause: init.cause });
		this.name = 'ProblemError';
		this.type = init.type;
		this.title = init.title;
		this.status = init.status;
		this.detail = init.detail;
		this.instance = init.instance;
		this.invalidParams = init.invalidParams;
		this.extensions = init.extensions ?? {};
	}

	toJSON(): ProblemDocument {
		const base: Record<string, unknown> = {
			type: this.type,
			...this.extensions,
		};
		if (this.title !== undefined) base.title = this.title;
		if (this.status !== undefined) base.status = this.status;
		if (this.detail !== undefined) base.detail = this.detail;
		if (this.instance !== undefined) base.instance = this.instance;
		if (this.invalidParams !== undefined) base['invalid-params'] = this.invalidParams;
		return base as ProblemDocument;
	}
}

export function parseProblem(input: unknown): ProblemDocument | undefined {
	const result = problemSchema.safeParse(input);
	return result.success ? result.data : undefined;
}

export function problemFromDocument(doc: ProblemDocument, cause?: unknown): ProblemError {
	const {
		type,
		title,
		status,
		detail,
		instance,
		['invalid-params']: invalidParams,
		...rest
	} = doc;
	return new ProblemError({
		type,
		title,
		status,
		detail,
		instance,
		invalidParams,
		extensions: rest,
		cause,
	});
}

export function problemFromResponse(
	response: Response,
	body: unknown,
	cause?: unknown,
): ProblemError {
	const parsed = parseProblem(body);
	if (parsed) return problemFromDocument(parsed, cause);
	return new ProblemError({
		type: 'about:blank',
		title: response.statusText || 'HTTP error',
		status: response.status,
		detail: typeof body === 'string' ? body : undefined,
		cause,
	});
}

export function isProblemResponse(response: Response): boolean {
	const ct = response.headers.get('content-type') ?? '';
	return ct.toLowerCase().includes('application/problem+json');
}
