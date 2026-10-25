# Migrating SvelteKit 2 → 3

> Required for all downstream applications adopting `@sveltesentio/*` packages.
> Per [ADR-0058](../adr/0058-sveltekit-3-peer-range.md) the framework peerDependency floor
> for `@sveltejs/kit` is `^3.0.0`; **SvelteKit 2 is unsupported**.

## Why SvelteKit 3 is required

- **ADR-0058** updates the `@sveltejs/kit` peer range to `^3.0.0` across all consuming packages (`ai`, `auth`, `core`, `forms`, `i18n`, `query`, `realtime`, `shell`).
- SvelteKit 2 has known unfixed security advisories (GHSA-27mw-82g8-phjj, GHSA-pfhg-q3qv-9q6r); SvelteKit 3.0.0+ resolves them with zero open advisories.
- Removes dual-major compatibility shims across framework packages and test suites.

## Upgrading dependencies

Update your application's `package.json`:

```diff
  "devDependencies": {
-   "@sveltejs/kit": "^2.0.0",
+   "@sveltejs/kit": "^3.0.0",
```

## Automated migration with `sv`

Run the upstream migration tool, which SvelteKit's own migration guide names:

```bash
npx sv migrate sveltekit-3
```

The tool migrates many, not all, of the breaking changes. The [upstream SvelteKit 3 migration guide](https://svelte.dev/docs/kit/migrating-to-sveltekit-3) lists each change and the manual steps, among them:

- configuration moves out of `svelte.config.js` into the options of the `sveltekit` Vite plugin;
- the `$lib` alias is replaced by a `#lib` subpath import declared in `package.json`, with module extensions on each import.

## sveltesentio code

The packages type their SvelteKit hooks from `sequence` in `@sveltejs/kit/hooks` and import no hook type by name, so `handle` exports built with `@sveltesentio/auth` or `@sveltesentio/core` need no change. The `#lib` import forms of [docs/compose](../compose/README.md) already work on SvelteKit 3.
