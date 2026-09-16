# Changelog

## [0.5.0](https://github.com/golusoris/sveltesentio/compare/ai-v0.4.0...ai-v0.5.0) (2026-09-16)


### Features

* **governance:** declare HISS-20 enforcement evidence, backed by fixtures ([e803ea4](https://github.com/golusoris/sveltesentio/commit/e803ea401055b15ea7e9df5eeb0a4c37cf714963))


### Bug Fixes

* **deps:** repair regressions introduced by the Praetor dependency pass ([f14552b](https://github.com/golusoris/sveltesentio/commit/f14552be15d1fe0c9e94ce4caecae098a8789106))
* **types:** put test code under a TypeScript project, and fix the 32 errors ([1138831](https://github.com/golusoris/sveltesentio/commit/11388316e60e6f3fb738255750b2e5606a52d848))


### Code Refactoring

* clear two more length violations and dedupe the history trim ([20a0b36](https://github.com/golusoris/sveltesentio/commit/20a0b36ad33ad25b43969ae09b0249f6c85f6f6c))

## [0.4.0](https://github.com/golusoris/sveltesentio/compare/ai-v0.3.0...ai-v0.4.0) (2026-06-19)

### Features

- **ai:** ./server (LLM proxy over @anthropic-ai/sdk + ollama, EU-AI-Act audit hook) + ./client (useLLMChat + &lt;ChatStream&gt;) ([f3e954d](https://github.com/golusoris/sveltesentio/commit/f3e954d57450f4124c7208c8e63990f59271a4f6))

## [0.3.0](https://github.com/golusoris/sveltesentio/compare/ai-v0.2.0...ai-v0.3.0) (2026-06-15)

### Features

- **ai:** EU AI Act audit hook (Zod schema) + server-proxy LLM + edge seam ([a29b71d](https://github.com/golusoris/sveltesentio/commit/a29b71d9cc5d08c97e8e68e07a7c0f443b0181bd))

## [0.1.0](https://github.com/golusoris/sveltesentio/compare/ai-v0.0.2...ai-v0.1.0) (2026-06-14)

### Features

- land foundation packages and repair CI gate ([#41](https://github.com/golusoris/sveltesentio/issues/41)) ([7557620](https://github.com/golusoris/sveltesentio/commit/75576200e324cd4c55f48571a6532540c1f6eb16))

### Bug Fixes

- **ui,ai:** resolve export maps — land ui oklch tokens + presets, drop ai ./edge ([d51d81e](https://github.com/golusoris/sveltesentio/commit/d51d81ef07f5b8afe952e7d9e85fb27be51dfe5c))
