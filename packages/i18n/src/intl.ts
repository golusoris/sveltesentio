export function formatNumber(
	value: number,
	locale: string,
	options?: Intl.NumberFormatOptions,
): string {
	return new Intl.NumberFormat(locale, options).format(value);
}

export function formatCurrency(
	value: number,
	locale: string,
	currency: string,
	options?: Omit<Intl.NumberFormatOptions, 'style' | 'currency'>,
): string {
	return new Intl.NumberFormat(locale, {
		...options,
		style: 'currency',
		currency,
	}).format(value);
}

export function formatDate(
	value: Date | number | string,
	locale: string,
	options?: Intl.DateTimeFormatOptions,
): string {
	const date = value instanceof Date ? value : new Date(value);
	return new Intl.DateTimeFormat(locale, options).format(date);
}

export function formatRelativeTime(
	value: number,
	unit: Intl.RelativeTimeFormatUnit,
	locale: string,
	options?: Intl.RelativeTimeFormatOptions,
): string {
	return new Intl.RelativeTimeFormat(locale, options).format(value, unit);
}

export function formatList(
	values: readonly string[],
	locale: string,
	options?: Intl.ListFormatOptions,
): string {
	return new Intl.ListFormat(locale, options).format(values);
}
