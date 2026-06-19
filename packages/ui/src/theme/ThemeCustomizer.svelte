<!--
@component
ThemeCustomizer — tier-3 end-user token overrides (ADR-0046). Renders a labelled
oklch field per customisable semantic token; the pure validation + emission logic
is the unit-tested `./customizer.ts`. Peer-free. Persistence has NO default
(ADR-0046): the component surfaces a sanitised override via the `onchange`
callback so the consumer writes it to its own user-preferences endpoint.

`override` is bindable. Live preview: the sanitised override is applied to the
`<form>` element's own `style`, so the swatches reflect the current values
immediately without touching `:root`.

A11y: a `<form>` with a `<fieldset>`/`<legend>`, each control a real `<input>`
bound to a `<label for>`. The reset is a native `<button>`. Invalid oklch input
sets `aria-invalid` on the field so assistive tech announces the error.
-->
<script lang="ts">
	import { buttonClass } from '../button/variants.js';
	import { inputClass } from '../input/variants.js';
	import { lightTokens, type SemanticTokens } from '../tokens/index.js';
	import {
		isValidOklch,
		overrideToInlineStyle,
		sanitizeOverride,
		type ThemeOverride,
		type ThemeOverrideChange,
	} from './customizer.js';

	interface Props {
		/** Current override map (bindable). */
		override?: ThemeOverride;
		/** Which tokens to expose. Default: the brand-ish subset users tweak. */
		tokens?: readonly (keyof SemanticTokens)[];
		/** Called with the sanitised override after every edit. */
		onchange?: ThemeOverrideChange;
		/** Stable id base for label/field wiring. */
		idBase?: string;
		/** Extra classes appended to the form. */
		class?: string;
	}

	let {
		override = $bindable({}),
		tokens = ['primary', 'accent', 'destructive', 'ring'],
		onchange,
		idBase = 'ssentio-theme',
		class: className,
	}: Props = $props();

	// Live preview: only the sanitised (valid) entries reach the inline style.
	const previewStyle = $derived(overrideToInlineStyle(override));
	const fieldId = (token: string): string => `${idBase}-${token}`;

	function placeholderFor(token: keyof SemanticTokens): string {
		return lightTokens[token];
	}

	function setToken(token: keyof SemanticTokens, value: string): void {
		const next: ThemeOverride = { ...override };
		if (value.trim() === '') delete next[token];
		else next[token] = value;
		override = next;
		onchange?.(sanitizeOverride(next));
	}

	function reset(): void {
		override = {};
		onchange?.({});
	}
</script>

<form
	class={['flex flex-col gap-4', className].filter(Boolean).join(' ')}
	style={previewStyle}
	aria-label="Theme customizer"
>
	<fieldset class="flex flex-col gap-3 border-0 p-0">
		<legend class="text-sm font-medium text-foreground">Accent tokens (oklch)</legend>
		{#each tokens as token (token)}
			{@const value = override[token] ?? ''}
			{@const invalid = value !== '' && !isValidOklch(value)}
			<div class="flex flex-col gap-1">
				<label class="text-xs text-muted-foreground" for={fieldId(token)}>{token}</label>
				<input
					id={fieldId(token)}
					class={inputClass(invalid)}
					type="text"
					inputmode="text"
					spellcheck="false"
					autocomplete="off"
					placeholder={placeholderFor(token)}
					aria-invalid={invalid ? 'true' : undefined}
					value={value}
					oninput={(event) => setToken(token, event.currentTarget.value)}
				/>
			</div>
		{/each}
	</fieldset>

	<button type="button" class={buttonClass('outline', 'sm')} onclick={reset}>
		Reset to defaults
	</button>
</form>
