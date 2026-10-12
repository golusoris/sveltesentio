import type { Preview } from '@storybook/svelte-vite';
import { WCAG_22_AA_TAGS } from '@sveltesentio/testing/a11y';

const preview: Preview = {
	parameters: {
		controls: {
			matchers: {
				color: /(background|color)$/i,
				date: /Date$/i,
			},
		},
		a11y: {
			// axe runs on every story; a violation fails the story's test (`pnpm test:stories`).
			test: 'error',
			// The rule set every accessibility lane of this repository shares (ADR-0031).
			options: { runOnly: { type: 'tag', values: [...WCAG_22_AA_TAGS] } },
		},
		layout: 'centered',
	},
	tags: ['autodocs'],
};

export default preview;
