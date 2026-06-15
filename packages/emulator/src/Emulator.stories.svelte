<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import Emulator from './Emulator.svelte';

	// EmulatorJS is a self-hosted/CDN WASM bundle, NOT an npm module. Without the
	// loader script + data directory present, `injectEmulatorScript` simply
	// appends a `<script>` that 404s and sets the `EJS_*` globals — a harmless
	// no-op for the showcase. These stories therefore document the SSR-safe MOUNT
	// SHELL (`role="application"` region with its 4:3 black canvas area); the
	// actual game surface only appears when the data directory is served.
	const { Story } = defineMeta({
		title: 'emulator/Emulator',
		component: Emulator,
		tags: ['autodocs'],
		argTypes: {
			core: { control: 'text' },
			gameUrl: { control: 'text' },
			dataPath: { control: 'text' },
			gameName: { control: 'text' },
			color: { control: 'text' },
			label: { control: 'text' },
			startOnLoad: { control: 'boolean' },
		},
		args: {
			core: 'snes',
			gameUrl: '/roms/sample.sfc',
			gameName: 'Sample Cartridge',
		},
	});
</script>

<!-- Default SNES shell: the labelled `role="application"` mount region. -->
<Story name="Default" args={{ core: 'snes', gameUrl: '/roms/sample.sfc', gameName: 'Sample Cartridge' }} />

<!-- A different platform slug resolves to a different EmulatorJS core. -->
<Story name="PlayStation" args={{ core: 'playstation', gameUrl: '/roms/sample.bin', gameName: 'PS1 Demo' }} />

<!-- Self-hosted data directory + UI accent colour passed through to EmulatorJS. -->
<Story
	name="Self hosted"
	args={{
		core: 'gba',
		gameUrl: '/roms/sample.gba',
		gameName: 'GBA Demo',
		dataPath: '/emulatorjs/data/',
		color: '00bcd4',
	}}
/>

<!-- Custom accessible label on the emulator region. -->
<Story
	name="Labelled"
	args={{ core: 'genesis', gameUrl: '/roms/sample.md', label: 'Sega Genesis emulator' }}
/>
