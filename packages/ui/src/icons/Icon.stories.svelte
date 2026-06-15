<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import Icon from './Icon.svelte';
  import StubIcon from '../../../../apps/storybook/.storybook/StubIcon.svelte';
  import { registerIconLoader } from './registry.js';

  // The default icon set (@lucide/svelte) is an OPTIONAL peer that is not
  // installed in this Storybook workspace. Register a self-contained stub
  // loader so `<Icon>` resolves and renders without the peer. Names ending in
  // `-missing` are intentionally left unresolved to exercise the placeholder.
  registerIconLoader((name: string) => (name.endsWith('-missing') ? undefined : StubIcon));

  const { Story } = defineMeta({
    title: 'ui/icons/Icon',
    component: Icon,
    tags: ['autodocs'],
    argTypes: {
      name: { control: 'text' },
      size: { control: { type: 'number', min: 8, max: 96, step: 4 } },
      label: { control: 'text' },
    },
    args: {
      name: 'arrow-left',
      size: 24,
    },
  });
</script>

<!-- Decorative by default: no `label`, so `aria-hidden` and skipped by AT. -->
<Story name="Decorative" args={{ name: 'arrow-left', size: 32 }} />

<!-- Meaningful: a `label` promotes the icon to `role="img"` + `aria-label`. -->
<Story name="Labelled" args={{ name: 'settings', size: 32, label: 'Open settings' }} />

<Story name="Large" args={{ name: 'search', size: 64 }} />

<!-- Unresolved name renders the empty, layout-stable, `aria-hidden` placeholder. -->
<Story name="Unresolved" args={{ name: 'does-not-exist-missing', size: 32 }} />
