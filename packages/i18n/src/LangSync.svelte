<!--
@component
LangSync — root-layout hook that keeps `<html lang>` + `<html dir>` in sync with
the active locale (ADR-0018 a11y action item #1). Without this, a locale switch
leaves the document advertising the wrong language to assistive tech and never
flips to RTL for Arabic / Hebrew / Persian / Urdu / Yiddish, breaking both
screen-reader pronunciation (WCAG 2.2 SC 3.1.2) and logical-property layout.

Renders nothing. Drop one `<LangSync locale={…} />` at the top of the root
`+layout.svelte`. On every `locale` change it:

  1. sets `document.documentElement.lang` to the BCP-47 tag,
  2. sets `dir` via the landed `getTextDirection`,
  3. announces the transition through the landed `announceNavigation` live
     region so SR users hear that the language changed.

Direction logic lives in `./direction` and the announcer in `./announcer` —
both pure / DOM-only and unit-tested there; this file only wires the effect.
-->
<script lang="ts">
	import { getTextDirection } from './direction.js';
	import { announceNavigation } from './announcer.js';

	interface Props {
		/** Active locale as a BCP-47 tag (e.g. `'de-AT'`, `'ar'`). */
		locale: string;
		/**
		 * Message announced to screen readers on change. Receives the new locale;
		 * return `null`/`''` to suppress the announcement. Default: a terse
		 * `"Language changed to <locale>"`.
		 */
		// eslint-disable-next-line no-unused-vars -- name in a function-type is type-position-only; svelte-eslint-parser misreports it as an unused binding
		announce?: (locale: string) => string | null;
	}

	const { locale, announce }: Props = $props();

	const direction = $derived(getTextDirection(locale));

	$effect(() => {
		if (typeof document === 'undefined') return;
		const root = document.documentElement;
		root.lang = locale;
		root.dir = direction;

		const message = announce ? announce(locale) : `Language changed to ${locale}`;
		if (message) announceNavigation(message);
	});
</script>
