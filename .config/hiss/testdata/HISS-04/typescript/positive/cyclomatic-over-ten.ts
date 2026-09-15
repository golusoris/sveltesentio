// Cyclomatic complexity 11 against a cap of 10. ESLint reports:
//   error  Function 'classify' has a complexity of 11. Maximum allowed is 10
export function classify(n: number, flags: readonly boolean[]): string {
	if (n < 0) return 'negative';
	if (n === 0) return 'zero';
	if (n < 10) return 'small';
	if (n < 100) return 'medium';
	if (n < 1000) return 'large';
	if (flags[0]) return 'flag0';
	if (flags[1]) return 'flag1';
	if (flags[2]) return 'flag2';
	if (flags[3]) return 'flag3';
	if (flags[4]) return 'flag4';
	return 'other';
}
