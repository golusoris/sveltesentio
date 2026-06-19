<script lang="ts">
  import type { Component } from 'svelte';

  interface PageData {
    title: string;
    component: Component;
  }

  let { data }: { data: PageData } = $props();

  const Doc = $derived(data.component);
</script>

<svelte:head>
  <title>{data.title} — sveltesentio</title>
</svelte:head>

<article class="prose">
  <Doc />
</article>

<style>
  .prose :global(h1) {
    font-size: clamp(1.8rem, 4vw, 2.4rem);
    margin-top: 0;
  }

  .prose :global(h2) {
    margin-top: 2.5rem;
    padding-bottom: 0.3rem;
    border-bottom: 1px solid var(--border);
  }

  .prose :global(h3) {
    margin-top: 1.8rem;
  }

  .prose :global(img) {
    max-width: 100%;
    height: auto;
  }

  .prose :global(ul),
  .prose :global(ol) {
    padding-left: 1.4rem;
  }
</style>
