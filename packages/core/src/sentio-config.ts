import { z } from 'zod';

/** Interface-type preset (§2.6): desktop pointer, 10-foot TV, handheld touch. */
export const interfaceTypeSchema = z.enum(['desktop', 'tenfoot', 'handheld']);
export type InterfaceType = z.infer<typeof interfaceTypeSchema>;

/**
 * Schema for the typed `$sentio` virtual module — build-time configuration
 * surfaced to client + server code via `import { ... } from '$sentio'`. Feed
 * the validated result of {@link defineSentioConfig} to the Vite plugin as
 * `sentioPlugin({ virtualModule })`.
 */
export const sentioConfigSchema = z.object({
	/** Build-time app version surfaced to client code. */
	version: z.string().min(1).default('0.0.0'),
	/** Default interface-type preset used before client-side classification. */
	interfaceType: interfaceTypeSchema.default('desktop'),
	/** Static feature flags resolved at build time (flag name → enabled). */
	features: z.record(z.string(), z.boolean()).default({}),
	/** Active theme preset name. */
	theme: z.string().min(1).default('default'),
});

export type SentioConfig = z.infer<typeof sentioConfigSchema>;

/** Thrown by {@link defineSentioConfig} when the input fails validation. */
export class SentioConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SentioConfigError';
	}
}

/**
 * Validate + normalise a `$sentio` config. Fills defaults for omitted fields
 * and throws {@link SentioConfigError} with a readable summary on invalid
 * input, so misconfiguration fails the build instead of reaching the client.
 */
export function defineSentioConfig(input: unknown = {}): SentioConfig {
	const result = sentioConfigSchema.safeParse(input);
	if (!result.success) {
		const detail = result.error.issues
			.map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
			.join('\n');
		throw new SentioConfigError(`[sentio] Invalid $sentio config:\n${detail}`);
	}
	return result.data;
}
