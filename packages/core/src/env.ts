import type { ZodObject, ZodRawShape, infer as ZodInfer } from 'zod';
import { z } from 'zod';

export class EnvValidationError extends Error {
	readonly tree: unknown;
	constructor(kind: 'server' | 'public', tree: unknown) {
		super(`Invalid ${kind} environment. ${summarise(tree)}`);
		this.name = 'EnvValidationError';
		this.tree = tree;
	}
}

export interface EnvOptions<
	TServer extends ZodRawShape,
	TPublic extends ZodRawShape,
> {
	server: ZodObject<TServer>;
	publicEnv: ZodObject<TPublic>;
	runtimeEnv: Record<string, string | undefined>;
	skipValidation?: boolean;
}

export type Env<
	TServer extends ZodRawShape,
	TPublic extends ZodRawShape,
> = Readonly<ZodInfer<ZodObject<TServer>> & ZodInfer<ZodObject<TPublic>>>;

export function createEnv<
	TServer extends ZodRawShape,
	TPublic extends ZodRawShape,
>(options: EnvOptions<TServer, TPublic>): Env<TServer, TPublic> {
	const { server, publicEnv, runtimeEnv, skipValidation = false } = options;

	if (skipValidation) {
		return runtimeEnv as unknown as Env<TServer, TPublic>;
	}

	const serverResult = server.safeParse(runtimeEnv);
	if (!serverResult.success) {
		throw new EnvValidationError('server', z.treeifyError(serverResult.error));
	}

	const publicResult = publicEnv.safeParse(runtimeEnv);
	if (!publicResult.success) {
		throw new EnvValidationError('public', z.treeifyError(publicResult.error));
	}

	return Object.freeze({
		...serverResult.data,
		...publicResult.data,
	});
}

export function requireEnv(name: string, value: string | undefined): string {
	if (value === undefined || value === '') {
		throw new EnvValidationError('server', {
			errors: [`Required environment variable "${name}" is not set`],
		});
	}
	return value;
}

function summarise(tree: unknown): string {
	try {
		return JSON.stringify(tree, null, 2);
	} catch {
		return '[unserialisable tree]';
	}
}
