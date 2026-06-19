<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';
  import type { Snippet } from 'svelte';
  import type { NavGroup } from '$lib/docs';

  interface LayoutData {
    nav: NavGroup[];
  }

  let { data, children }: { data: LayoutData; children: Snippet } = $props();

  const currentSlug = $derived(page.params.slug ?? '');
</script>

<div class="layout">
  <a class="skip-link" href="#main">Skip to content</a>
  <aside class="sidebar" aria-label="Documentation navigation">
    <a class="brand" href="/">
      <span class="brand-mark" aria-hidden="true">s</span>
      <span>sveltesentio</span>
    </a>
    <nav>
      <ul class="nav-root">
        <li>
          <a href="/" class:active={page.url.pathname === '/'}>Overview</a>
        </li>
      </ul>
      {#each data.nav as group (group.section)}
        <div class="nav-group">
          <h2 class="nav-label">{group.label}</h2>
          <ul>
            {#each group.docs as doc (doc.slug)}
              <li>
                <a
                  href={`/docs/${doc.slug}`}
                  class:active={currentSlug === doc.slug}
                  aria-current={currentSlug === doc.slug ? 'page' : undefined}
                >
                  {doc.title}
                </a>
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    </nav>
  </aside>
  <main id="main" class="content">
    {@render children()}
  </main>
</div>

<style>
  .layout {
    display: grid;
    grid-template-columns: var(--sidebar-width) 1fr;
    min-height: 100vh;
  }

  .skip-link {
    position: absolute;
    left: -999px;
    top: 0;
    background: var(--accent);
    color: var(--accent-fg);
    padding: 0.5rem 1rem;
    z-index: 10;
  }

  .skip-link:focus {
    left: 0;
  }

  .sidebar {
    border-right: 1px solid var(--border);
    background: var(--surface);
    padding: 1.5rem 1rem;
    position: sticky;
    top: 0;
    height: 100vh;
    overflow-y: auto;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 700;
    font-size: 1.15rem;
    color: var(--fg);
    margin-bottom: 1.5rem;
  }

  .brand:hover {
    text-decoration: none;
  }

  .brand-mark {
    display: grid;
    place-items: center;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 6px;
    background: var(--accent);
    color: var(--accent-fg);
    font-weight: 700;
  }

  nav ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .nav-group {
    margin-top: 1.25rem;
  }

  .nav-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    margin: 0 0 0.4rem;
    font-weight: 700;
  }

  nav li a {
    display: block;
    padding: 0.25rem 0.5rem;
    border-radius: 6px;
    color: var(--fg);
    font-size: 0.9rem;
  }

  nav li a:hover {
    background: var(--code-bg);
    text-decoration: none;
  }

  nav li a.active {
    background: var(--accent);
    color: var(--accent-fg);
  }

  .content {
    padding: 2.5rem clamp(1.5rem, 5vw, 4rem);
    max-width: 60rem;
    margin: 0 auto;
    width: 100%;
  }

  @media (max-width: 48rem) {
    .layout {
      grid-template-columns: 1fr;
    }

    .sidebar {
      position: static;
      height: auto;
      border-right: none;
      border-bottom: 1px solid var(--border);
    }
  }
</style>
