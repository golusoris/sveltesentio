# Migration codemods

A codemod rewrites downstream code for one breaking change, so an adopter runs it instead of editing by hand. Each one belongs to the migration guide of the release that made the change: [`docs/migrations/v<MAJOR.MINOR>.md`](../../docs/migrations/README.md).

No codemod ships yet. Every breaking change so far migrated by hand, and [`docs/migrations/v0.2.md`](../../docs/migrations/v0.2.md) declares `codemods: 0`.

How an adopter runs a codemod is open in issue #554 and is decided before the first codemod ships.

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

`<case>` contains letters, digits, `_` and `-`; each part of `<ext>` contains letters and digits. A dotted case name such as `optional.chain.input.ts` is not a fixture name; the check reports it.

## The transform

`transform.mjs` default-exports one function:

```js
/** @param {string} source  @param {string} filePath  @returns {string | Promise<string>} */
export default function transform(source, filePath) {
  return source.replaceAll('oldName(', 'newName(');
}
```

It takes a file's text and path and returns the rewritten text. It must be pure: no file writes, no network, no reading the clock. Any engine fits behind it: a string rewrite, a `jscodeshift` or `ast-grep` transform, or the Svelte compiler's parser. The path lets it pick a parser by extension. The check calls it with the fixture's path minus `.input` or `.output` (`fixtures/basic.ts` for `basic.input.ts`), the same path on both runs.

Each call gets a fresh module instance, so a transform cannot pass the second run by remembering the first.

## What the check enforces

[`scripts/check-migration-codemods.mjs`](../../scripts/check-migration-codemods.mjs) runs in `make verify-all` and in the CI `lint` job, and fails when:

- a guide's `codemods` frontmatter count differs from the number of codemod directories under its `v<MAJOR.MINOR>/`, or the frontmatter is missing or not a whole number;
- a `v<MAJOR.MINOR>/` directory has no guide, or a directory here is not named `v<MAJOR.MINOR>`;
- a codemod has no `transform.mjs`, or it does not default-export a function;
- `fixtures/` holds no complete `<case>.input<ext>` and `<case>.output<ext>` pair, a file lacks its partner, or a file there is not named as a fixture;
- the transform's result for an input differs from its output fixture (the finding names the first differing line);
- the transform changes its own output fixture on a second run at the same path: a codemod must be safe to run twice;
- a directory holds more entries than its limit, and then nothing in it is checked: 1,000 entries in `docs/migrations/`, 200 here in `tools/migrations/`, 100 in one version directory, 200 in one `fixtures/`; or a guide's frontmatter does not close within 200 lines;
- the transform throws, returns something other than a string, or exceeds the 30-second deadline; each transform call runs in a fresh worker thread that the check stops after the result or at the deadline, so a slow synchronous transform or a loop that never returns fails the check and a timer left running cannot hang it.

The whole run, including discovery, has a 5-minute deadline with one finding naming it; the run ends at most one 10-second file-system call past that deadline.

Run it locally:

```bash
pnpm check:migration-codemods
```
