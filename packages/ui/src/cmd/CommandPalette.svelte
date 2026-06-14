<!--
@component
CommandPalette — a thin command palette over the pure `CommandRegistry`
(ADR-0025). Renders the WAI-ARIA combobox + listbox pattern (input owns the
list, `aria-activedescendant` tracks the highlighted option) so it is keyboard-
and screen-reader-accessible out of the box.

By repo policy the shadcn-svelte `Command` primitive (backed by `bits-ui`) is
CLI-delivered into the consuming app (ADR-0014/0025); to use it, swap this
markup for `<Command.Root>` etc. and keep driving it from this same registry.
This default implementation imports NO optional peer so it works standalone.

Plain `tsc` does not type-check `.svelte`; the typed, tested logic lives in
`./registry.ts` (search/rank) and `./keybinding.ts` (the `$mod+K` keymap).
-->
<script lang="ts">
  import { CommandRegistry, type Command } from './registry.js';
  import { matchesShortcut } from './keybinding.js';

  interface Props {
    /** The command registry to search. */
    registry: CommandRegistry;
    /** Whether the palette is open (bindable). */
    open?: boolean;
    /** Placeholder for the search input. */
    placeholder?: string;
    /** Shortcut that toggles the palette open. Default `$mod+K`. */
    toggleShortcut?: string;
    /** Stable id base for ARIA wiring. */
    idBase?: string;
  }

  let {
    registry,
    open = $bindable(false),
    placeholder = 'Type a command or search…',
    toggleShortcut = '$mod+K',
    idBase = 'ssentio-cmd',
  }: Props = $props();

  let query = $state('');
  let activeIndex = $state(0);

  const results = $derived(registry.search(query));
  const listId = $derived(`${idBase}-list`);
  const inputId = $derived(`${idBase}-input`);

  function optionId(index: number): string {
    return `${idBase}-opt-${index}`;
  }

  function clampActive(): void {
    if (activeIndex > results.length - 1) activeIndex = Math.max(0, results.length - 1);
  }

  async function runAt(index: number): Promise<void> {
    const ranked = results[index];
    if (!ranked) return;
    open = false;
    query = '';
    await ranked.command.run();
  }

  function onWindowKeydown(event: KeyboardEvent): void {
    if (matchesShortcut(event, toggleShortcut)) {
      event.preventDefault();
      open = !open;
    } else if (event.key === 'Escape' && open) {
      open = false;
    }
  }

  function onInputKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      activeIndex = Math.min(results.length - 1, activeIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeIndex = Math.max(0, activeIndex - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      void runAt(activeIndex);
    }
  }

  $effect(() => {
    void query;
    activeIndex = 0;
  });

  $effect(() => {
    void results;
    clampActive();
  });

  function labelFor(command: Command): string {
    return command.subtitle ? `${command.title} — ${command.subtitle}` : command.title;
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#if open}
  <div class="ssentio-cmd__backdrop">
    <!-- Dismiss overlay: a real <button> so it is click- AND keyboard-operable;
         Escape is also handled at the window level. -->
    <button
      type="button"
      class="ssentio-cmd__dismiss"
      aria-label="Close command palette"
      tabindex="-1"
      onclick={() => (open = false)}
    ></button>
    <div
      class="ssentio-cmd__panel"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      tabindex="-1"
    >
      <!-- svelte-ignore a11y_autofocus -->
      <input
        id={inputId}
        class="ssentio-cmd__input"
        type="text"
        role="combobox"
        autocomplete="off"
        autofocus
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={results.length > 0 ? optionId(activeIndex) : undefined}
        {placeholder}
        bind:value={query}
        onkeydown={onInputKeydown}
      />
      <ul id={listId} class="ssentio-cmd__list" role="listbox" aria-label="Commands">
        {#each results as ranked, index (ranked.command.id)}
          <!-- Keyboard selection is the combobox pattern (input arrows + Enter,
               tracked by aria-activedescendant); click/mousemove are redundant
               mouse affordances, so the keydown-handler a11y rule does not apply. -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <li
            id={optionId(index)}
            class="ssentio-cmd__option"
            class:ssentio-cmd__option--active={index === activeIndex}
            role="option"
            aria-selected={index === activeIndex}
            onclick={() => runAt(index)}
            onmousemove={() => (activeIndex = index)}
          >
            <span class="ssentio-cmd__title">{labelFor(ranked.command)}</span>
            {#if ranked.command.shortcut}
              <kbd class="ssentio-cmd__shortcut">{ranked.command.shortcut}</kbd>
            {/if}
          </li>
        {/each}
        {#if results.length === 0}
          <li class="ssentio-cmd__empty" role="option" aria-selected="false" aria-disabled="true">
            No commands found.
          </li>
        {/if}
      </ul>
    </div>
  </div>
{/if}

<style>
  .ssentio-cmd__backdrop {
    position: fixed;
    inset: 0;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-block-start: 12vh;
  }

  .ssentio-cmd__dismiss {
    position: fixed;
    inset: 0;
    border: 0;
    padding: 0;
    cursor: default;
    background: rgb(0 0 0 / 0.4);
  }

  .ssentio-cmd__panel {
    position: relative;
    inline-size: min(40rem, 92vw);
    border-radius: var(--ui-radius, 0.5rem);
    background: var(--ssentio-cmd-bg, Canvas);
    color: var(--ssentio-cmd-fg, CanvasText);
    overflow: hidden;
    box-shadow: 0 16px 48px rgb(0 0 0 / 0.3);
  }

  .ssentio-cmd__input {
    inline-size: 100%;
    box-sizing: border-box;
    padding: 1rem;
    font-size: var(--ui-font-size-base, 1rem);
    min-block-size: var(--ui-min-target-size, 24px);
    border: 0;
    border-block-end: 1px solid var(--ui-border, currentColor);
    background: transparent;
    color: inherit;
  }

  .ssentio-cmd__list {
    margin: 0;
    padding: 0.25rem;
    list-style: none;
    max-block-size: 50vh;
    overflow-y: auto;
  }

  .ssentio-cmd__option {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
    padding: 0.625rem 0.75rem;
    min-block-size: var(--ui-min-target-size, 24px);
    border-radius: calc(var(--ui-radius, 0.5rem) - 0.25rem);
    cursor: pointer;
  }

  .ssentio-cmd__option--active {
    background: var(--ui-accent, rgb(0 0 0 / 0.08));
  }

  .ssentio-cmd__shortcut {
    font-size: 0.75rem;
    opacity: 0.7;
  }

  .ssentio-cmd__empty {
    padding: 0.75rem;
    opacity: 0.7;
  }
</style>
