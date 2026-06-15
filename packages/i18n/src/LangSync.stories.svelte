<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import LangSync from './LangSync.svelte';
	import { getTextDirection } from './direction.js';

	// LangSync renders no markup of its own: it is a side-effect component that
	// reflects the active `locale` onto `<html lang>` / `<html dir>` and announces
	// the change through the aria-live region. The stories therefore pair it with
	// a tiny readout harness so the otherwise-blank canvas shows what it did.

	const { Story } = defineMeta({
		title: 'i18n/LangSync',
		component: LangSync,
		tags: ['autodocs'],
		argTypes: {
			locale: { control: 'text' },
		},
		args: {
			locale: 'en-US',
		},
	});
</script>

{#snippet readout(locale: string)}
	<LangSync {locale} />
	<dl
		style:font-family="system-ui, sans-serif"
		style:display="grid"
		style:grid-template-columns="auto auto"
		style:gap="0.25rem 1rem"
		style:margin="0"
	>
		<dt style:font-weight="600">locale</dt>
		<dd style:margin="0"><code>{locale}</code></dd>
		<dt style:font-weight="600">computed dir</dt>
		<dd style:margin="0"><code>{getTextDirection(locale)}</code></dd>
		<dt style:font-weight="600">document.documentElement.lang</dt>
		<dd style:margin="0"><code>{`<html lang="${locale}">`}</code></dd>
	</dl>
	<p style:font-family="system-ui, sans-serif" style:color="GrayText" style:max-inline-size="40ch">
		LangSync emits no markup. It sets <code>&lt;html lang&gt;</code> +
		<code>&lt;html dir&gt;</code> and announces the change to screen readers.
	</p>
{/snippet}

<!-- A left-to-right locale: dir resolves to "ltr". -->
<Story name="LTR (English)">
	{@render readout('en-US')}
</Story>

<!-- German — also LTR; demonstrates a region subtag on the lang attribute. -->
<Story name="German">
	{@render readout('de-AT')}
</Story>

<!-- Arabic: a right-to-left language → dir flips to "rtl". -->
<Story name="RTL (Arabic)">
	{@render readout('ar')}
</Story>

<!-- RTL resolved from an explicit script subtag rather than the language. -->
<Story name="RTL via script subtag">
	{@render readout('ku-Arab')}
</Story>
