export type TextDirection = 'ltr' | 'rtl';

const RTL_SCRIPTS = new Set([
	'Arab',
	'Aran',
	'Hebr',
	'Syrc',
	'Thaa',
	'Nkoo',
	'Rohg',
	'Mand',
	'Mend',
	'Samr',
]);

const RTL_LANGUAGES = new Set([
	'ar',
	'arc',
	'ckb',
	'dv',
	'fa',
	'ha',
	'he',
	'iw',
	'ji',
	'ks',
	'ku',
	'nqo',
	'pnb',
	'ps',
	'sd',
	'syr',
	'ug',
	'ur',
	'yi',
]);

export function getTextDirection(locale: string): TextDirection {
	if (!locale) return 'ltr';
	const tag = locale.trim();
	if (tag.length === 0) return 'ltr';

	const subtags = tag.split(/[-_]/);
	const language = subtags[0]?.toLowerCase() ?? '';
	const script = subtags.find((sub) => sub.length === 4);

	if (script) {
		const normalised = script[0]?.toUpperCase() + script.slice(1).toLowerCase();
		if (RTL_SCRIPTS.has(normalised)) return 'rtl';
	}

	return RTL_LANGUAGES.has(language) ? 'rtl' : 'ltr';
}
