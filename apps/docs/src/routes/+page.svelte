<script lang="ts">
  import type { PackageEntry } from '$lib/packages';

  interface PageData {
    packages: PackageEntry[];
    publicCount: number;
  }

  let { data }: { data: PageData } = $props();

  // apps/storybook builds to storybook-static/. There is no deployed URL yet
  // (V0.1.0 release-DoD pending), so we link the in-repo build path and flag
  // the deployment as a TODO.
  const storybookPath = '../storybook/storybook-static/index.html';
</script>

<svelte:head>
  <title>sveltesentio — framework documentation</title>
</svelte:head>

<header class="hero">
  <h1>sveltesentio</h1>
  <p class="lede">
    A SvelteKit framework — {data.publicCount} composable
    <code>@sveltesentio/*</code> packages, Svelte 5 runes-first, OWASP ASVS L2 + WCAG 2.2 AA by default.
  </p>
  <div class="hero-actions">
    <a class="btn btn-primary" href="/docs/principles">Read the §2 contract</a>
    <a class="btn" href="/docs/adr/README">Browse ADRs</a>
    <a class="btn" href={storybookPath}>Component showcase ↗</a>
  </div>
</header>

<section class="callout" aria-labelledby="showcase-heading">
  <h2 id="showcase-heading">Component showcase</h2>
  <p>
    The live component gallery is published by <strong>apps/storybook</strong>
    (Storybook 10 + Svelte 5). Build it with
    <code>pnpm --filter @sveltesentio/storybook build</code> and open
    <code>apps/storybook/storybook-static/index.html</code>.
  </p>
  <p class="todo">
    TODO: replace the in-repo path with the deployed Storybook URL once the V0.1.0 release pipeline
    publishes it.
  </p>
</section>

<section aria-labelledby="packages-heading">
  <h2 id="packages-heading">Packages ({data.packages.length})</h2>
  <p class="section-note">
    Every <code>@sveltesentio/*</code> workspace package, indexed at build time from each
    <code>package.json</code>.
  </p>
  <ul class="package-grid">
    {#each data.packages as pkg (pkg.name)}
      <li class="package-card">
        <div class="package-head">
          <h3>{pkg.name}</h3>
          <span class="version">v{pkg.version}</span>
        </div>
        {#if pkg.description}
          <p>{pkg.description}</p>
        {/if}
        <a class="npm-link" href={pkg.npmUrl} rel="external noreferrer"> npm ↗ </a>
      </li>
    {/each}
  </ul>
</section>

<section aria-labelledby="docs-heading">
  <h2 id="docs-heading">Documentation</h2>
  <ul class="doc-links">
    <li><a href="/docs/principles">§2 Coding Contract</a> — the quality bar.</li>
    <li><a href="/docs/ux-principles">§3 UX Principles</a> — interface-type design paradigms.</li>
    <li><a href="/docs/adr/README">Architecture Decision Records</a> — the decision log.</li>
    <li><a href="/docs/compliance/README">Compliance</a> — OWASP / WCAG / EU CRA / EU AI Act.</li>
    <li><a href="/docs/compose/README">Composition recipes</a> — compose-don't-wrap patterns.</li>
  </ul>
</section>

<style>
  .hero {
    padding: 1rem 0 2rem;
    border-bottom: 1px solid var(--border);
    margin-bottom: 2rem;
  }

  .hero h1 {
    font-size: clamp(2.2rem, 6vw, 3.2rem);
    margin: 0 0 0.5rem;
  }

  .lede {
    font-size: 1.15rem;
    color: var(--muted);
    max-width: 42rem;
  }

  .hero-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-top: 1.5rem;
  }

  .btn {
    display: inline-block;
    padding: 0.55rem 1.1rem;
    border-radius: 8px;
    border: 1px solid var(--border);
    color: var(--fg);
    font-weight: 600;
    font-size: 0.95rem;
  }

  .btn:hover {
    text-decoration: none;
    background: var(--code-bg);
  }

  .btn-primary {
    background: var(--accent);
    color: var(--accent-fg);
    border-color: var(--accent);
  }

  .btn-primary:hover {
    background: var(--accent);
    filter: brightness(1.08);
  }

  .callout {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 1.25rem 1.5rem;
    margin-bottom: 2.5rem;
  }

  .callout h2 {
    margin-top: 0;
  }

  .todo {
    color: var(--muted);
    font-size: 0.9rem;
  }

  .section-note {
    color: var(--muted);
  }

  .package-grid {
    list-style: none;
    margin: 1rem 0 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
    gap: 1rem;
  }

  .package-card {
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .package-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .package-head h3 {
    margin: 0;
    font-size: 0.95rem;
    font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
  }

  .version {
    color: var(--muted);
    font-size: 0.8rem;
    white-space: nowrap;
  }

  .package-card p {
    margin: 0;
    font-size: 0.9rem;
    color: var(--muted);
    flex: 1;
  }

  .npm-link {
    font-size: 0.85rem;
    font-weight: 600;
    align-self: flex-start;
  }

  .doc-links {
    line-height: 2;
  }
</style>
