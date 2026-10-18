// Paraglide runtime + locale-aware Intl helpers (RTL-aware).
import {
	paraglideVitePlugin,
	getTextDirection,
	formatCurrency,
	formatDate,
} from '@sveltesentio/i18n';

export const dir = getTextDirection('ar'); // 'rtl'
export const price = formatCurrency(19.99, { locale: 'de-DE', currency: 'EUR' }); // "19,99 €"
export const when = formatDate(Date.now(), { locale: 'ja-JP' });

// vite.config.ts: compile the message catalogue.
export const plugins = [
	paraglideVitePlugin({ project: './project.inlang', outdir: './src/lib/paraglide' }),
];
