<script lang="ts">
  import { Story, Variant } from 'histoire';
  import ThemeToggle from '../src/components/ThemeToggle.svelte';
</script>

<Story title="ui/ThemeToggle" group="ui">
  <Variant title="Default (20px)">
    <ThemeToggle />
  </Variant>

  <Variant title="Large (32px)">
    <ThemeToggle size={32} />
  </Variant>

  <Variant title="With custom class">
    <ThemeToggle class="custom-class" />
  </Variant>

  <Variant title="Custom label">
    <ThemeToggle label="Switch to dark mode" />
  </Variant>
</Story>
