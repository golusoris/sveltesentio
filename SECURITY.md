# Security policy

## Reporting a vulnerability

Please **do not** open public GitHub issues for security vulnerabilities.

Prefer a [private GitHub Security Advisory](https://github.com/lusoris/sveltesentio/security/advisories/new).
Alternative: email `lusoris@pm.me`.

We aim to acknowledge within 48 hours and provide a remediation plan within 7 days.

## Supported versions

Only the latest minor release is patched. Apps should bump promptly when an
advisory is published. Pre-1.0 releases (`0.x`) follow the same discipline —
patch bumps fix vulnerabilities, minor bumps may include breaking changes
with a `Migration:` footer.

## Supply chain

State measured on 2026-10-11 against the last release (2026-06-20). Releases are:

- Built in CI from `main` with every GitHub Action pinned to a commit SHA.
- Attested with [SLSA](https://slsa.dev/) provenance at Build Level 2: the
  release job signs a GitHub artifact attestation over the published source
  files (`packages/*/src/**`).

Verify a file of a published package against its attestation:

```bash
# From a checkout of the release tag, for example core-v0.3.0:
gh attestation verify packages/core/src/index.ts --repo golusoris/sveltesentio
```

Not in place yet, tracked in
[#280](https://github.com/golusoris/sveltesentio/issues/280):

- **SLSA Build Level 3.** The standards manifest declares it. The attestation
  is signed in the job that builds and publishes, which is Level 2. A dated
  exception (rule `HISS-11` in `.standards.yaml`) records the gap and expires
  on 2027-01-09.
- **cosign signatures.** No release carries a signature or certificate file.
- **npm provenance.** The release job requests it, but none of the 19 published
  package versions shows a provenance attestation in the registry.
- **SBOM.** The release job generates a CycloneDX SBOM as a workflow artifact
  that expires with the run. It is not attached to the release.

## Dependencies

Tracked by Dependabot (security alerts + routine bumps). Auto-merge on
green CI for minor/patch; majors require human review. `pnpm audit` must
be clean on every merge to `main` (enforced by `make ci`).

## Compliance

sveltesentio's framework-level controls map to:

- [docs/compliance/owasp-asvs-l2.md](docs/compliance/owasp-asvs-l2.md) — OWASP ASVS 5.0 Level 2.
- [docs/compliance/wcag-2.2-aa.md](docs/compliance/wcag-2.2-aa.md) — WCAG 2.2 Level AA.
- [docs/compliance/eu-cra.md](docs/compliance/eu-cra.md) — EU Cyber Resilience Act (Reg. (EU) 2024/2847), FOSS-steward role.
- [docs/compliance/eu-ai-act.md](docs/compliance/eu-ai-act.md) — EU AI Act (Reg. (EU) 2024/1689), deployer-side primitives.
