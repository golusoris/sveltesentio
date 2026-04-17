import type { ZodObject, ZodRawShape, infer as ZodInfer } from 'zod';
import { AppError } from './errors.js';

export interface EnvOptions<
  TServer extends ZodRawShape,
  TPublic extends ZodRawShape,
> {
  /** Private server-only env vars. Never accessible on the client. */
  server: ZodObject<TServer>;
  /** Public env vars. Must be prefixed with PUBLIC_ in SvelteKit. */
  public: ZodObject<TPublic>;
  /** Override source — defaults to process.env. Useful for testing. */
  runtimeEnv?: Record<string, string | undefined>;
  /** Skip validation — useful when type-checking without real env. */
  skipValidation?: boolean;
}

export type Env<
  TServer extends ZodRawShape,
  TPublic extends ZodRawShape,
> = ZodInfer<ZodObject<TServer>> & ZodInfer<ZodObject<TPublic>>;

export function createEnv<
  TServer extends ZodRawShape,
  TPublic extends ZodRawShape,
>(options: EnvOptions<TServer, TPublic>): Env<TServer, TPublic> {
  const { server, public: publicSchema, skipValidation = false } = options;

  const source = options.runtimeEnv ?? (typeof process !== 'undefined' ? process.env : {});

  if (skipValidation) {
    return source as Env<TServer, TPublic>;
  }

  const serverResult = server.safeParse(source);
  if (!serverResult.success) {
    const issues = serverResult.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));
    const summary = issues.map((i) => `  ${i.path}: ${i.message}`).join('\n');
    throw new AppError('INTERNAL', `Invalid server environment:\n${summary}`, { issues });
  }

  const publicResult = publicSchema.safeParse(source);
  if (!publicResult.success) {
    const issues = publicResult.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));
    const summary = issues.map((i) => `  ${i.path}: ${i.message}`).join('\n');
    throw new AppError('INTERNAL', `Invalid public environment:\n${summary}`, { issues });
  }

  return { ...serverResult.data, ...publicResult.data } as Env<TServer, TPublic>;
}

/**
 * Helper to assert that a value is not undefined.
 * Use for env vars in SvelteKit's $env/static/* modules.
 */
export function requireEnv(name: string, value: string | undefined): string {
  if (value === undefined || value === '') {
    throw new AppError('INTERNAL', `Required environment variable "${name}" is not set`);
  }
  return value;
}
