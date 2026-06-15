<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import CommandPalette from './CommandPalette.svelte';
  import { CommandRegistry } from './registry.js';

  function noop(): void {
    // Stories never navigate; the run() side effect is intentionally empty.
  }

  const registry = new CommandRegistry().register(
    {
      id: 'new-doc',
      title: 'New document',
      subtitle: 'Create a blank file',
      shortcut: '$mod+N',
      run: noop,
    },
    {
      id: 'open',
      title: 'Open…',
      subtitle: 'Open an existing file',
      shortcut: '$mod+O',
      run: noop,
    },
    { id: 'save', title: 'Save', subtitle: 'Write changes to disk', shortcut: '$mod+S', run: noop },
    { id: 'search', title: 'Search', keywords: ['find', 'grep'], shortcut: '$mod+F', run: noop },
    {
      id: 'settings',
      title: 'Settings',
      subtitle: 'Open preferences',
      shortcut: '$mod+,',
      run: noop,
    },
    { id: 'toggle-theme', title: 'Toggle theme', keywords: ['dark', 'light'], run: noop },
    { id: 'logout', title: 'Log out', group: 'Account', run: noop },
  );

  const empty = new CommandRegistry();

  const { Story } = defineMeta({
    title: 'ui/cmd/CommandPalette',
    component: CommandPalette,
    tags: ['autodocs'],
    // Rendered open so the combobox/listbox is visible in the canvas; in an app
    // it toggles via `$mod+K`.
    args: {
      registry,
      open: true,
    },
  });
</script>

<!-- Open with a full command set; arrow keys + Enter drive selection. -->
<Story name="Open" args={{ registry, open: true }} />

<!-- A custom placeholder and shortcut hint. -->
<Story
  name="Custom placeholder"
  args={{ registry, open: true, placeholder: 'Jump to a command…' }}
/>

<!-- Empty registry exercises the "No commands found." empty state. -->
<Story name="Empty" args={{ registry: empty, open: true }} />
