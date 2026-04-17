# Skill: wire-module

Add a new `@sveltesentio/*` package to the monorepo.

## When to use

When the user asks to add a new module/package that doesn't exist yet.

## Steps

1. Create `packages/<name>/` directory structure:

```
packages/<name>/
├── src/
│   └── index.ts
├── package.json
├── tsconfig.json
└── README.md
```

2. `packages/<name>/package.json`:

```json
{
  "name": "@sveltesentio/<name>",
  "version": "0.0.1",
  "type": "module",
  "private": false,
  "sideEffects": false,
  "exports": {
    ".": {
      "import": "./src/index.ts",
      "types": "./src/index.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "peerDependencies": {},
  "devDependencies": {
    "typescript": "^6.0.3",
    "vitest": "^4.1.4"
  }
}
```

3. `packages/<name>/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
```

4. `packages/<name>/src/index.ts`:

```typescript
// @sveltesentio/<name> — Phase N
// TODO: implement
export {};
```

5. Add to `release-please-config.json` packages section:
```json
"packages/<name>": { "package-name": "@sveltesentio/<name>" }
```

6. Add to `.release-please-manifest.json`:
```json
"packages/<name>": "0.0.1"
```

7. Add entry to `AGENTS.md` package purpose table.

8. Update `.workingdir/STATE.md` with the new package.
