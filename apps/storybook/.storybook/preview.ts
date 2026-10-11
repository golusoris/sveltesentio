import type { Preview } from '@storybook/svelte-vite';

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
		},
		layout: 'centered',
	},
	tags: ['autodocs'],
};

export default preview;
