# Migration codemods

A codemod rewrites downstream code for one breaking change, so an adopter runs it instead of editing by hand. Each one belongs to the migration guide of the release that made the change: [`docs/migrations/v<MAJOR.MINOR>.md`](../../docs/migrations/README.md).

No codemod ships yet. Every breaking change so far migrated by hand, and [`docs/migrations/v0.2.md`](../../docs/migrations/v0.2.md) declares `codemods: 0`.

## Layout

```text
tools/migrations/
  v<MAJOR.MINOR>/
    <codemod-name>/
      transform.mjs
      fixtures/
        <case>.input<ext>
        <case>.output<ext>
```

`<ext>` is the extension of the files the codemod rewrites, and may have several parts: `basic.input.ts` pairs with `basic.output.ts`, `runes.input.svelte.ts` with `runes.output.svelte.ts`.

## The transform

`transform.mjs` default-exports one function:

```js
/** @param {string} source  @param {string} filePath  @returns {string | Promise<string>} */
export default function transform(source, filePath) {
  return source.replaceAll('oldName(', 'newName(');
}
```

It takes a file's text and path and returns the rewritten text. It must be pure: no file writes, no network, no reading the clock. Any engine fits behind it: a string rewrite, a `jscodeshift` or `ast-grep` transform, or the Svelte compiler's parser. The path lets it pick a parser by extension.

## What the check enforces

[`scripts/check-migration-codemods.mjs`](../../scripts/check-migration-codemods.mjs) runs in `make verify-all` and in the CI `lint` job, and fails when:

- a guide's `codemods` frontmatter count differs from the number of codemod directories under its `v<MAJOR.MINOR>/`, or the frontmatter is missing or not a whole number;
- a `v<MAJOR.MINOR>/` directory has no guide, or a directory here is not named `v<MAJOR.MINOR>`;
- a codemod has no `transform.mjs`, or it does not default-export a function;
- `fixtures/` holds no complete `<case>.input<ext>` and `<case>.output<ext>` pair, a file lacks its partner, or a file there is not named as a fixture;
- the transform's result for an input differs from its output fixture (the finding names the first differing line);
- the transform changes its own output fixture: a codemod must be safe to run twice;
- the transform throws, returns something other than a string, or does not settle within 30 seconds.

The deadline bounds a codemod that awaits forever; a synchronous loop that never returns is bounded only by the CI job's `timeout-minutes`.

Run it locally:

```bash
pnpm check:migration-codemods
```
