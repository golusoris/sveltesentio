// Two diagnostics tsc reports under this repo's compilerOptions:
//   TS7006 Parameter 'value' implicitly has an 'any' type
//   TS2532 Object is possibly 'undefined'   (noUncheckedIndexedAccess)
// @ts-nocheck is deliberately NOT used: the file is evidence, not compiled code.
export function widen(value) {
	return value;
}

export function firstLength(items: readonly string[]): number {
	return items[0].length;
}
