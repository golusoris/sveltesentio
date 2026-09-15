// `!` discards the undefined case that noUncheckedIndexedAccess surfaces.
// Reported since this repository enabled
// `@typescript-eslint/no-non-null-assertion` over packages/*/src, which was free.
//
// A gap fixture when the catalog was written; moved here when the rule was
// turned on.
export function firstOrThrow(items: readonly string[]): string {
	return items[0]!;
}
