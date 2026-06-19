<script lang="ts">
  import { page } from '$app/state';
</script>

<svelte:head>
  <title>{page.status} — sveltesentio docs</title>
</svelte:head>

<section class="error">
  <h1>{page.status}</h1>
  <p>{page.error?.message ?? 'Something went wrong.'}</p>
  <p><a href="/">Back to overview</a></p>
</section>

<style>
  .error {
    padding: 3rem 0;
  }

  .error h1 {
    font-size: 4rem;
    margin: 0;
    color: var(--accent);
  }
</style>
