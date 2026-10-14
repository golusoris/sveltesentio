import { secret } from '#lib/server/secret.js';

export function load(): { secretLength: number } {
	return { secretLength: secret.length };
}
