# Compliance

Framework-level checklists for the regulations + standards sveltesentio
targets.

| Document | Scope | Trigger |
|---|---|---|
| [owasp-asvs-l2.md](owasp-asvs-l2.md) | OWASP ASVS 5.0 Level 2 | Every merge to `main`. |
| [wcag-2.2-aa.md](wcag-2.2-aa.md) | WCAG 2.2 Level AA | Every UI primitive + per-minor release. |
| [eu-cra.md](eu-cra.md) | EU Cyber Resilience Act (Reg. (EU) 2024/2847) | Quarterly review; reporting obligations from 2026-09-11. |
| [eu-ai-act.md](eu-ai-act.md) | EU AI Act (Reg. (EU) 2024/1689) | On each delegated/implementing act publication; high-risk go-live 2026-08-02. |

Each checklist distinguishes:

- `✅` shipped as default by sveltesentio;
- `⚠️` consumer responsibility (framework provides a primitive);
- `🔲` planned, with owner + target milestone;
- `N/A` not applicable at the framework surface.

Downstream apps (`golusoris/app-*` and other consumers) inherit the
framework defaults but remain responsible for application-level controls
that can only be asserted at deployment time.
