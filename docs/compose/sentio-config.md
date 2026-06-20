# `$sentio` virtual module

Build-time configuration surfaced to client + server code through the `$sentio`
virtual module, emitted by `sentioPlugin` (`@sveltesentio/core/vite`). One
validated config object becomes typed imports anywhere in your app — no runtime
fetch, no env plumbing for static values.

API lives in `@sveltesentio/core`; ambient types in `@sveltesentio/core/sentio`.

## The schema

`defineSentioConfig(input)` validates against `sentioConfigSchema` (Zod v4),
fills defaults, and throws `SentioConfigError` with a readable summary on bad
input — so misconfiguration fails the build instead of reaching the client.

| Field | Type | Default | Purpose |
|---|---|---|---|
| `version` | `string` (min 1) | `'0.0.0'` | Build-time app version surfaced to client code. |
| `interfaceType` | `'desktop' \| 'tenfoot' \| 'handheld'` | `'desktop'` | Default interface-type preset (§2.6) before client classification. |
| `features` | `Record<string, boolean>` | `{}` | Static feature flags resolved at build time. |
| `theme` | `string` (min 1) | `'default'` | Active theme preset name. |

## 1. Wire it into Vite

```ts
// vite.config.ts
import { sveltekit } from '@sveltejs/kit/vite';
import { sentioPlugin, defineSentioConfig } from '@sveltesentio/core';

export default {
	plugins: [
		sveltekit(),
		sentioPlugin({
			virtualModule: defineSentioConfig({
				version: process.env.APP_VERSION ?? '0.0.0',
				interfaceType: 'desktop',
				features: { beta: true },
				theme: 'midnight',
			}),
		}),
	],
};
```

`defineSentioConfig` is the typed, validated path; `virtualModule` itself still
accepts any freeform record when you need an escape hatch.

## 2. Make the types visible

Reference the ambient declaration once (e.g. in `src/app.d.ts`):

```ts
/// <reference types="@sveltesentio/core/sentio" />
```

…or add `"@sveltesentio/core/sentio"` to `compilerOptions.types` in
`tsconfig.json`.

## 3. Import anywhere — fully typed

```ts
import config, { version, interfaceType, features, theme } from '$sentio';

if (features.beta) enableBeta();
console.warn(`sveltesentio app ${version} (${interfaceType}/${theme})`);
```

The named exports mirror the config keys; the default export is the frozen
`Readonly<SentioConfig>` object.

## Notes

- Values are inlined at build time — treat them as public. Never put secrets in
  `$sentio`; use `@sveltesentio/core/env` for validated runtime secrets.
- Changing config requires a rebuild; it is not a runtime store.
