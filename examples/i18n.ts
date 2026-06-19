// Paraglide runtime + locale-aware Intl helpers (RTL-aware).
import {
  paraglideVitePlugin,
  getTextDirection,
  formatCurrency,
  formatDate,
} from '@sveltesentio/i18n';

const dir = getTextDirection('ar'); // 'rtl'
const price = formatCurrency(19.99, { locale: 'de-DE', currency: 'EUR' }); // "19,99 €"
const when = formatDate(Date.now(), { locale: 'ja-JP' });
