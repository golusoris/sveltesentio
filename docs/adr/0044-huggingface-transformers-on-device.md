# ADR-0044: `@huggingface/transformers@^4.1` for on-device AI; `@xenova/transformers` deprecated

- **Status**: Accepted
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D132 in `.workingdir/research/decisions-needed.md`

## Context

On-device AI (in-browser inference) needs a browser-runnable transformers library. `@xenova/transformers@2.17.2` was the canonical pick, but the project transferred to Hugging Face and now ships under `@huggingface/transformers` (v4.1.0+, Apache-2.0). `@xenova/transformers` is frozen since 2024. WebLLM / mlc-llm are heavier-weight alternatives targeting WebGPU LLM inference specifically — useful but narrower.

## Decision

Pin `@huggingface/transformers@^4.1.0` inside `@sveltesentio/ai/on-device`:

- WebGPU by default; WASM fallback for browsers without WebGPU.
- Model loading + inference helpers exposed as runes-friendly async iterables.
- Models loaded from HF hub or self-hosted; consumer config.

Hold WebLLM / mlc-llm as `docs/compose/ai-in-browser-llm.md` for LLM-specific use cases (>1B-param models, quantised).

## Alternatives considered

- **`@xenova/transformers`** — frozen; migration path is the rename.
- **ONNX Runtime Web direct** — lower level; reinvents tokenisation + pipeline API.
- **WebLLM as default** — heavier; targets LLMs specifically; not every on-device task needs an LLM.

## Consequences

**Positive**:

- Active upstream; security patches land.
- WebGPU acceleration where supported; WASM graceful fallback.
- One import path for classification / embedding / ASR / translation tasks.

**Negative / trade-offs**:

- Model sizes non-trivial (tens to hundreds of MB); consumers must be explicit about download cost.
- Browser support matrix for WebGPU still uneven on Firefox; WASM fallback carries a perf hit.

**Documentation obligations**:

- `docs/compose/ai-on-device.md` — model-loading strategy, size budgets, WebGPU detection.
- `docs/compose/ai-in-browser-llm.md` — WebLLM opt-in for LLM-specific flows.
- `@sveltesentio/ai/on-device` AGENTS.md — pinned version + migration from xenova.

## Evidence

- `.workingdir/research/ecosystem-pass-1-summary.md:104` — D132 pick.
- npm registry: `@huggingface/transformers@4.1.0` (Apache-2.0); `@xenova/transformers@2.17.2` frozen 2024.
