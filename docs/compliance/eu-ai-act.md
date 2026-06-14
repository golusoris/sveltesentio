# EU AI Act — sveltesentio checklist

> Target: [Regulation (EU) 2024/1689](https://eur-lex.europa.eu/eli/reg/2024/1689/oj)
> (Artificial Intelligence Act, "AI Act"), in force from 1 August 2024.
> Phased application:
>
> - **2 February 2025** — prohibited AI practices (Art. 5).
> - **2 August 2025** — general-purpose AI model provider obligations
>   (Chapter V) + governance (Chapter VII).
> - **2 August 2026** — high-risk AI system obligations (Chapter III) +
>   transparency obligations for certain AI systems (Art. 50) + most other
>   provisions.
> - **2 August 2027** — high-risk obligations for AI embedded in products
>   covered by Annex I Section A harmonisation legislation.
>
> Scope: `@sveltesentio/ai` is a **client + server proxy** for AI inference;
> it is not itself an AI model or system provider. Consumers integrating
> third-party models (OpenAI, Anthropic, HuggingFace, local) become
> **deployers** under the AI Act, and their obligations depend on the
> system's risk classification. sveltesentio's role is to make the
> **deployer-side** obligations tractable: logging, transparency disclosure
> components, human-oversight primitives, data-governance hooks.
>
> Legend: `✅` shipped; `⚠️` consumer responsibility (framework primitive
> available); `🔲` planned; `N/A` doesn't apply at the framework surface.

## Role determination

| Role | Definition (AI Act Art. 3) | Applies to |
|---|---|---|
| **Provider** | Develops / has developed an AI system / GPAI model + places it on the market. | Third-party model vendors; sveltesentio consumers who fine-tune their own models. |
| **Deployer** | Uses an AI system under its authority (except personal non-professional). | `golusoris/app-*` consumers + commercial sveltesentio consumers. |
| **Distributor / Importer** | Makes AI systems available on the Union market without provider-like modifications. | N/A for sveltesentio. |
| **Product manufacturer** | Places a product on the market with an AI system embedded. | Consumers embedding on-device models (ADR-0044). |

`@sveltesentio/ai` itself is **not** a provider or deployer; it is a
framework component that helps consumers act as compliant deployers.

## Prohibited practices (Art. 5) — since 2 February 2025

These are never permitted and sveltesentio primitives do not enable them.
Consumers are responsible for not configuring the framework to violate
these prohibitions.

| # | Prohibition | Framework stance |
|---|---|---|
| 5(1)(a) | Subliminal / manipulative / deceptive techniques that materially distort behaviour. | Transparency components in `@sveltesentio/ai` surface every AI-generated output. |
| 5(1)(b) | Exploiting vulnerabilities due to age / disability / socio-economic situation. | Framework convention; no mitigation on top of consumer discretion. |
| 5(1)(c) | Social scoring. | Out of scope; framework offers no ranking primitive. |
| 5(1)(d) | Predictive policing based solely on profiling. | Out of scope. |
| 5(1)(e) | Untargeted facial-image scraping for recognition databases. | `@sveltesentio/media` exposes no facial-recognition primitive. |
| 5(1)(f) | Emotion inference in workplace / education. | Out of scope. |
| 5(1)(g) | Biometric categorisation by sensitive attributes. | Out of scope. |
| 5(1)(h) | Real-time remote biometric ID in public spaces by law enforcement. | Out of scope. |

## Transparency obligations (Art. 50) — from 2 August 2026

### Art. 50(1) — AI systems that interact with natural persons

Consumers must inform users that they are interacting with an AI system,
unless it is obvious from context.

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 50.1.1 | Explicit disclosure component when a chat / agent surface is AI-backed. | ✅ | `@sveltesentio/ai` exports `<AiDisclosure>` component; ADR-0043. |
| 50.1.2 | Disclosure visible at the start of interaction + persistent. | ✅ | Component defaults to sticky top-of-flow placement; keyboard-reachable. |
| 50.1.3 | Accessible to users with disabilities. | ✅ | Component inherits WCAG 2.2 AA defaults. |

### Art. 50(2) — AI-generated synthetic content

Providers of generative AI systems must mark outputs in machine-readable
format. Deployers must inform users when content is AI-generated or
manipulated (deepfakes), unless artistic / creative exception applies.

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 50.2.1 | Watermarking / content credentials pass-through (C2PA). | 🔲 | `@sveltesentio/ai` + `@sveltesentio/media`: planned C2PA manifest read + display. |
| 50.2.2 | Deepfake disclosure component. | ✅ | Uses the same `<AiDisclosure>` with `kind="synthetic"` variant. |
| 50.2.3 | Text disclosure for AI-generated articles / informational content. | ⚠️ | Consumer responsibility; component provided. |

### Art. 50(3) — Emotion / biometric categorisation

Deployers must inform natural persons exposed to such systems.

`@sveltesentio/ai` ships no emotion-recognition or biometric-categorisation
primitive. Consumers adding one are responsible for the notice.

### Art. 50(4) — AI audit log

Deployers must keep logs of high-risk AI use (Art. 26(6)) for at least 6 months.

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 50.4.1 | Every AI request logged with input hash + output hash + model id + timestamp. | ✅ | ADR-0045 — audit hook with Zod schema. |
| 50.4.2 | Tamper-evident log (append-only + signed). | ⚠️ | Consumer storage; framework provides signed envelope. |
| 50.4.3 | Retention of ≥ 6 months. | ⚠️ | Consumer responsibility. |

## High-risk AI systems (Annex III) — from 2 August 2026

`@sveltesentio/ai` itself is **not** high-risk. Consumers deploying systems
in Annex III categories (biometrics, critical infrastructure, education,
employment, essential services, law enforcement, migration, justice, etc.)
must satisfy Chapter III Section 2 obligations.

Framework primitives available:

| # | Obligation | Status | Evidence |
|---|---|---|---|
| 9 | Risk-management system. | ⚠️ | Consumer responsibility. |
| 10 | Data and data governance. | ⚠️ | Consumer responsibility. |
| 11 | Technical documentation. | ⚠️ | Framework exposes ADR template; consumer fills Annex IV template. |
| 12 | Record-keeping (automatic logging of events over the lifecycle). | ✅ | ADR-0045 log schema applies. |
| 13 | Transparency and provision of information to deployers. | ✅ | Component defaults. |
| 14 | Human oversight. | ✅ | `@sveltesentio/ai` `<HumanReview>` gate; consumer wires approval flow. |
| 15 | Accuracy, robustness and cybersecurity. | ⚠️ | Consumer responsibility; framework enforces OWASP ASVS L2 defaults. |

## General-purpose AI (GPAI) models (Chapter V) — since 2 August 2025

N/A — sveltesentio is not a GPAI provider. On-device HuggingFace models
(ADR-0044) are consumed as-is from the Hub; the Hub publisher is the
provider.

Consumers who fine-tune GPAI models become providers under Art. 25(1)(b).
Framework does not facilitate fine-tuning; consumers use upstream tooling.

## Data protection intersection

The AI Act complements (does not replace) GDPR. sveltesentio's stance:

- DPIA (GDPR Art. 35) is consumer responsibility when processing personal
  data through AI.
- Automated decision-making disclosures (GDPR Art. 22) are consumer
  responsibility.
- `@sveltesentio/ai` audit hook records only hashes + model metadata by
  default — raw inputs/outputs are not retained unless the consumer
  explicitly opts in.

## Open items

- C2PA manifest pass-through (item 50.2.1) — wire into `@sveltesentio/media`
  + `@sveltesentio/ai` before v0.2.
- Signed-envelope reference implementation for the audit log.
- Annex IV technical-documentation template — add under `docs/compliance/`.
- GPAI consumer guidance — document the "provider on fine-tune" boundary in
  `@sveltesentio/ai` README before v1.0.

## Review cadence

- Each Commission delegated / implementing act publication (expected
  throughout 2026).
- On the 2 August 2026 high-risk go-live.
- On the 2 August 2027 product-embedded high-risk go-live.
