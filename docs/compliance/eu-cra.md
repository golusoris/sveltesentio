# EU Cyber Resilience Act — sveltesentio checklist

> Target: [Regulation (EU) 2024/2847](https://eur-lex.europa.eu/eli/reg/2024/2847/oj)
> (Cyber Resilience Act, "CRA"), published 20 November 2024. Transition
> periods: reporting obligations begin 11 September 2026, full compliance
> 11 December 2027.
>
> Scope: sveltesentio is a **free and open-source software component**
> shipped without commercial activity by its maintainer. Under CRA
> Art. 2(5) + Recital 18, non-commercial FOSS is **out of scope** for the
> obligations that apply to "manufacturers" of products with digital
> elements. However, downstream consumers (`golusoris/app-*` and any
> commercial deployment) are in scope and inherit the artifacts listed
> below. This checklist tracks what sveltesentio ships so that downstream
> consumers can satisfy **Annex I** (essential cybersecurity requirements)
> and **Annex II** (information + instructions to users).
>
> Legend: `✅` shipped; `⚠️` partial / consumer responsibility; `🔲` planned.

## Role determination

| Role | Applies to | Notes |
|---|---|---|
| **FOSS steward** | sveltesentio (this repo) | Under CRA Art. 24, stewards have a lighter duty-of-care than manufacturers — primarily around documented security policy, vulnerability handling, and cooperation with ENISA. |
| **Manufacturer** | Commercial consumers deploying apps built on sveltesentio | Responsible for the full Annex I + Annex II obligations for the combined product. |
| **Importer / Distributor** | Package-registry operators; Linux distros packaging consumer apps | Out of scope for this document. |

## Annex I Part I — Security requirements relating to properties

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Designed + developed + produced with appropriate level of cybersecurity. | ✅ | docs/principles.md §2.2 (OWASP ASVS L2); OWASP ASVS L2 checklist. |
| 2 | Delivered without known exploitable vulnerabilities. | ✅ | `pnpm audit` clean gate in `make ci`; release blocks on any audit finding. |
| 3 | Delivered with a secure-by-default configuration. | ✅ | CSP headers, SameSite cookies, HttpOnly sessions, CSRF, DOMPurify all default-on. |
| 4 | Ensure protection against unauthorised access. | ✅ | `@sveltesentio/auth` deny-by-default (ADR-0035). |
| 5 | Protect confidentiality of stored / transmitted / otherwise processed data. | ⚠️ | Framework: HTTPS + HttpOnly + no secrets in client bundles. Consumer: at-rest encryption. |
| 6 | Protect integrity of stored / transmitted / processed data + commands + configuration. | ⚠️ | Framework: CSRF, SRI, Zod validation. Consumer: at-rest integrity. |
| 7 | Process only data that is adequate, relevant, and limited to what is necessary (data minimisation). | ⚠️ | Consumer responsibility. Framework docs flag this in per-package AGENTS.md. |
| 8 | Protect availability of essential + basic functions. | ⚠️ | Consumer responsibility. Framework ships graceful error boundaries (RFC 9457). |
| 9 | Minimise attack surface, including external interfaces. | ✅ | ESM-only, no CJS surface; tree-shakable exports; no dev endpoints in prod builds. |
| 10 | Reduce impact of incidents using appropriate exploitation mitigation. | ✅ | CSP nonce-based, SRI, no eval, strict transport security defaults. |
| 11 | Record + monitor relevant internal activity (security-relevant events). | ⚠️ | Framework ships `@sveltesentio/ai` audit hook (ADR-0045). Consumer: full app audit log. |
| 12 | Address vulnerabilities via security updates (free of charge where technically feasible). | ✅ | SemVer + release-please; patch releases are free; LTS policy documented in README. |

## Annex I Part II — Vulnerability handling requirements

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Identify + document vulnerabilities + components contained in the product, including SBOM. | 🔲 | Syft integration planned in `release-sveltekit.yml`. |
| 2 | Address + remediate vulnerabilities without delay, including by providing security updates. | ✅ | SECURITY.md — 48 h ack, 7 d assessment. |
| 3 | Apply effective + regular tests + reviews of security of the product. | ✅ | `make ci` runs on every PR + nightly Scorecard workflow. |
| 4 | Once a security update has been made available, publicly disclose information about fixed vulnerabilities. | ✅ | GitHub Security Advisories + CHANGELOG entry. |
| 5 | Put in place + enforce a coordinated vulnerability disclosure policy. | ✅ | SECURITY.md. |
| 6 | Facilitate the sharing of information about potential vulnerabilities. | ✅ | GitHub private advisory + email intake; `security.txt` planned. |
| 7 | Provide secure distribution mechanisms for security updates. | 🔲 | npm registry + provenance attestation + Sigstore signing (planned). |
| 8 | Ensure that security patches are disseminated without delay + free of charge + with advisory information. | ✅ | npm patch releases + CHANGELOG + GitHub Release notes. |

## Annex II — Information + instructions to users

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Manufacturer name + address + contact. | ✅ | `package.json` `author` field + SECURITY.md. |
| 2 | Product identifier (name + version). | ✅ | Per-package `package.json` + release tags. |
| 3 | Product purpose + intended use. | ✅ | README.md + per-package README.md. |
| 4 | Known / foreseeable risks from use (including cybersecurity). | ✅ | Per-package AGENTS.md "security notes" section. |
| 5 | Cybersecurity properties — designed with security-relevant info. | ✅ | SECURITY.md + this document + OWASP ASVS L2 checklist. |
| 6 | Contact for reporting vulnerabilities. | ✅ | SECURITY.md. |
| 7 | Type + duration of security-update support (end of life). | 🔲 | LTS policy to be added to README.md before v1.0. |
| 8 | Detailed instructions / online resources. | ✅ | docs/ directory + AGENTS.md. |
| 9 | If product processes personal data, description of what + where. | ✅ | Per-package PII boundary note (in progress). |
| 10 | Information on how users can securely install, operate, configure, decommission. | ⚠️ | AGENTS.md covers install + configure; decommission guidance planned. |

## Software Bill of Materials (SBOM)

Per Art. 13(24) + Annex I Part II (1). sveltesentio will ship an SBOM in
[CycloneDX](https://cyclonedx.org/) format with every release, generated via
[Syft](https://github.com/anchore/syft) in the `release-sveltekit.yml`
workflow.

- Format: CycloneDX 1.6 JSON.
- Scope: production dependencies only (`--scope runtime`).
- Publication: GitHub Release asset + npm registry provenance.

## Incident reporting

Per Art. 14. Manufacturers must report actively exploited vulnerabilities +
severe incidents to ENISA + CSIRT within 24 h of awareness (early warning) +
72 h (vulnerability notification) + 1 month (final report).

sveltesentio, as a FOSS steward, is **not** directly subject to these
reporting deadlines but maintains a shadow process aligned to
[CISA Coordinated Vulnerability Disclosure](https://www.cisa.gov/coordinated-vulnerability-disclosure-process)
to cooperate with downstream consumers:

- Initial ack: ≤ 48 h (SECURITY.md).
- Assessment: ≤ 7 d (SECURITY.md).
- Public disclosure: GitHub Security Advisory + CHANGELOG note + npm patch.

## Open items

- LTS policy (item 7 of Annex II) — draft before v1.0.
- Decommission guide (item 10 of Annex II) — add to AGENTS.md under
  "Lifecycle" section.
- SBOM automation (Annex I Part II #1) — wire Syft step.
- Sigstore keyless signing (Annex I Part II #7) — wire in release workflow.
- `security.txt` (Annex I Part II #6) — add `/.well-known/security.txt`
  template in `@sveltesentio/shell`.

## Review cadence

- Quarterly against latest ENISA guidance.
- On every CRA delegated / implementing act publication (expected Q3 2026
  for implementing acts on reporting format).
