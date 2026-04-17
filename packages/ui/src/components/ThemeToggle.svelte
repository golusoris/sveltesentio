<script lang="ts">
  import { toggleMode, mode } from 'mode-watcher';

  interface Props {
    /** Button label shown to screen readers. */
    label?: string;
    /** Size of the icon button in px. */
    size?: number;
    class?: string;
  }

  const { label = 'Toggle theme', size = 20, class: className = '' }: Props = $props();

  const isDark = $derived($mode === 'dark');
</script>

<button
  type="button"
  onclick={toggleMode}
  aria-label={label}
  aria-pressed={isDark}
  class="sentio-theme-toggle {className}"
  style="--size: {size}px"
>
  {#if isDark}
    <!-- Sun icon — switch to light -->
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  {:else}
    <!-- Moon icon — switch to dark -->
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  {/if}
</button>

<style>
  .sentio-theme-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--size);
    height: var(--size);
    padding: 0;
    border: none;
    border-radius: var(--radius-base, 8px);
    background: transparent;
    color: var(--text-secondary, currentColor);
    cursor: pointer;
    transition: color var(--duration-fast, 100ms) var(--easing-standard, ease),
                background-color var(--duration-fast, 100ms) var(--easing-standard, ease);
  }

  .sentio-theme-toggle:hover {
    color: var(--text-primary, currentColor);
    background-color: var(--surface-elevated, oklch(50% 0 0 / 0.1));
  }

  .sentio-theme-toggle:focus-visible {
    outline: var(--focus-ring-width, 2px) solid var(--focus-ring-color, currentColor);
    outline-offset: var(--focus-ring-offset, 2px);
  }
</style>
