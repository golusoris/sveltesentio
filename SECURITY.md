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

Releases are:

- Built reproducibly in CI from tagged source (pinned GitHub Actions SHAs).
- Signed with [cosign](https://docs.sigstore.dev/cosign/) (keyless, GitHub OIDC).
- Accompanied by a [syft](https://github.com/anchore/syft) CycloneDX 1.6 SBOM.
- Attested with [SLSA](https://slsa.dev/) L3 provenance.
- Published with `npm publish --provenance`.

Verify a published npm tarball:

```bash
# Download the tarball + signature + attestation from the GitHub Release,
# then verify:
cosign verify-blob \
  --certificate-identity-regexp '^https://github.com/lusoris/sveltesentio/' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  --signature sveltesentio-core-X.Y.Z.tgz.sig \
  --certificate sveltesentio-core-X.Y.Z.tgz.crt \
  sveltesentio-core-X.Y.Z.tgz
```

npm registry provenance is visible on each package page via the green
"Built and signed on GitHub Actions" badge.

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
