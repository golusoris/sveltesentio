# Security Policy

## Supported versions

Only the latest minor release receives security patches.

## Reporting a vulnerability

Report vulnerabilities via:

1. **GitHub private advisory** — preferred: [Security Advisories](https://github.com/golusoris/sveltesentio/security/advisories/new)
2. **Email** — lusoris@pm.me

Do not open a public issue for security vulnerabilities.

Expected response time: 48 hours for initial acknowledgement, 7 days for assessment.

## Release security

Every release includes:

- Reproducible builds via Turborepo + pinned action SHAs
- Keyless cosign signing via Sigstore
- SBOM (Software Bill of Materials) via Syft
- SLSA Level 3 provenance attestation
- `pnpm audit` clean on every merge

## Dependency management

- Dependabot monitors npm + GitHub Actions weekly
- Auto-merge enabled for Dependabot minor/patch updates that pass CI
- Major updates require manual review
