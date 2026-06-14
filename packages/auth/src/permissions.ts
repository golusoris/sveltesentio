export interface PermissionsApi {
	readonly permissions: readonly string[];
	has(key: string): boolean;
	can(pattern: string): boolean;
	anyOf(...patterns: string[]): boolean;
	allOf(...patterns: string[]): boolean;
}

export function createPermissions(input: readonly string[] | Iterable<string> | null | undefined): PermissionsApi {
	const set = new Set<string>();
	if (input) for (const p of input) set.add(p);
	const snapshot = Object.freeze([...set]);

	const has = (key: string) => set.has(key);
	const can = (pattern: string) => {
		if (!pattern) return false;
		if (set.has(pattern)) return true;
		if (set.has('*')) return true;
		const parts = pattern.split('.');
		for (let i = parts.length - 1; i >= 1; i -= 1) {
			const prefix = `${parts.slice(0, i).join('.')}.*`;
			if (set.has(prefix)) return true;
		}
		return false;
	};
	const anyOf = (...patterns: string[]) => patterns.some(can);
	const allOf = (...patterns: string[]) => patterns.every(can);

	return Object.freeze({
		permissions: snapshot,
		has,
		can,
		anyOf,
		allOf,
	});
}
