# `docs/compose/` — composition recipes for sveltesentio

Composition recipes document **how** to use third-party libraries or
native Web APIs inside the sveltesentio stack without wrapping them in
a `@sveltesentio/*` package. Each recipe is a self-contained, working
pattern with ADR citations, a11y + security invariants, anti-patterns,
and cross-links to siblings.

**When a library composes cleanly, we write a recipe instead of a
wrapper.** This is the streamlining rule — only wrap when a
cross-cutting invariant (preset sizing, structured errors, a11y
envelope the library doesn't provide) actually demands it.

See [principles.md](../principles.md) for the overall quality bar and
[ADR index](../adr/README.md) for the decision log.

## When to use what — decision trees

### Data layer

```text
Reading from an OpenAPI'd server            → http-client.md
Typed RPC with streaming                    → connectrpc.md
Server-sent events (one-way stream)         → sse.md
Bidi JSON without codegen                   → websocket.md
CRDT collaborative editing                  → collab.md → collab-persistence.md / collab-p2p.md
Server-state caching                        → server-state.md
Forms with server validation                → forms.md (+ schemas.md)
Any data boundary                           → schemas.md (Zod required)
```

### UI layer

```text
Primitives (Button, Dialog, Input)          → primitives-shadcn.md (default) / primitives-direct.md (escape)
Charts                                      → charts.md (default) / charts-realtime.md (uPlot) / charts-exotic.md (ECharts held)
Tables / virtualized lists                  → data-tables.md
Flow / graph canvas                         → flow-basics.md → flow-advanced.md
Command palette                             → command-palette.md
Toasts                                      → toast.md
Carousel                                    → carousel.md
Markdown rendering                          → markdown.md (+ trusted-types.md)
Media (video/audio)                         → media-player.md
File uploads (headless)                     → uploads.md / (with picker UI) uploads-uppy.md
```

### Auth + identity

```text
OIDC login flow                             → auth-oidc.md
Passkeys / WebAuthn                         → passkeys.md
MFA challenge surface                       → mfa.md
Permission gating                           → permissions.md
Session cookie contract                     → auth-oidc.md (cites ADR-0034)
```

### Theming + a11y + i18n

```text
Color tokens (oklch)                        → theming.md
Dark-mode cookie + SSR                      → theming-flash-free.md
Per-tenant branding                         → tenant-theming.md
Safe-area insets (notch, home indicator)    → safe-area.md
RTL + locale strategy                       → i18n-runtime-strategy.md
A11y triage workflow                        → a11y-audit-runbook.md
Stories (authoring + axe anchor)            → histoire-stories.md
Visual regression                           → playwright-visual.md
```

### AI

```text
Default chat streaming (single provider)    → ai-streaming.md
Multi-provider / tools / structured output  → ai-vercel-sdk.md
Agent loops (multi-step tool use + MCP)     → ai-vercel-sdk-agents.md
On-device (transformers.js, small models)   → ai-on-device.md
In-browser LLM (WebGPU, large models)       → ai-in-browser-llm.md
Compliance / EU AI Act audit                → ai-audit-hook.md (required for all AI paths)
```

### PWA + offline

```text
Service worker + manifest + install prompt  → pwa.md
Offline queue with Idempotency-Key          → background-sync.md
Native push notifications                   → web-push.md
Desktop-class file access                   → file-system-access.md
Safe-area / standalone mode                 → safe-area.md
Offline CRDT sync                           → collab-persistence.md
```

### Cross-cutting contracts

```text
Observability (OTel + UUIDv7 + RFC 9457)    → observability.md
Release pipeline (release-please)           → monorepo-releases.md
Clock injection (test-determinism)          → clock-injection.md
Colocated IPC (cross-surface messaging)     → colocated-ipc.md
Trusted Types (DOM-XSS defense-in-depth)    → trusted-types.md
```

## Recipe index (alphabetical)

| File | One-line purpose | Governing ADR(s) |
|---|---|---|
| [a11y-audit-runbook.md](a11y-audit-runbook.md) | axe-core violation triage workflow | 0031 |
| [account-deletion.md](account-deletion.md) | GDPR self-serve deletion + 30-day grace + tombstone + portable export | 0034, 0023 |
| [admin-ui-patterns.md](admin-ui-patterns.md) | Back-office tables + bulk actions + impersonation + audit viewer | 0035, 0023 |
| [ai-audit-hook.md](ai-audit-hook.md) | AI compliance event hook + sink contracts | 0045 |
| [ai-in-browser-llm.md](ai-in-browser-llm.md) | `@mlc-ai/web-llm` WebGPU LLM opt-in | 0044 |
| [ai-on-device.md](ai-on-device.md) | `@huggingface/transformers` small-model on-device | 0044 |
| [ai-streaming.md](ai-streaming.md) | Raw-SDK `+server.ts` proxy default | 0043 |
| [ai-vercel-sdk-agents.md](ai-vercel-sdk-agents.md) | Multi-step agent loops + MCP | 0043 |
| [ai-vercel-sdk.md](ai-vercel-sdk.md) | Vercel AI SDK opt-in upgrade path | 0043 |
| [analytics.md](analytics.md) | Plausible default + PostHog opt-in + consent-gated loading | — |
| [api-key-management.md](api-key-management.md) | Personal access tokens + service tokens + SHA-256 storage + prefix for scanner + auto-revoke on leak + rotation | 0032, 0034, 0035 |
| [api-versioning.md](api-versioning.md) | URL-segment default + RFC 8594 Sunset + deprecation flow | 0019 |
| [audit-log.md](audit-log.md) | Append-only tamper-evident user-action trail (compliance) | 0023 |
| [billing-tax.md](billing-tax.md) | Stripe Tax + tax-ID verification + EU reverse-charge + exemption certs + DAC7/1099 income events | 0019, 0023 |
| [billing-usage-metering.md](billing-usage-metering.md) | Usage-based billing pipeline (event → aggregate → Stripe usage record) + idempotent reporter + overage alerts + corrections | 0019, 0023 |
| [auth-oidc.md](auth-oidc.md) | OIDC relay + HttpOnly cookies | 0032, 0034 |
| [background-sync.md](background-sync.md) | Workbox offline queue + Idempotency-Key | 0028 |
| [backup-recovery.md](backup-recovery.md) | Tier-based RPO/RTO + Postgres PITR + KMS-encrypted cross-region + monthly drills | 0019, 0023 |
| [caching.md](caching.md) | `Cache-Control` matrix + SWR + CDN invariants + cookie pitfalls | 0019 |
| [carousel.md](carousel.md) | embla-carousel-svelte via shadcn | 0012, 0047 |
| [charts-exotic.md](charts-exotic.md) | svelte-echarts candlestick / gauge / 3D (held) | 0013 |
| [charts-realtime.md](charts-realtime.md) | uPlot canvas escape hatch >5k pts / ≥30 Hz | 0013 |
| [charts.md](charts.md) | LayerChart v2-next + `AccessibleChart` wrapper | 0013, 0031 |
| [clock-injection.md](clock-injection.md) | Injectable-clock pattern for deterministic tests | 0052 |
| [collab-p2p.md](collab-p2p.md) | y-webrtc opt-in with private signaling | 0009 |
| [collab-persistence.md](collab-persistence.md) | y-indexeddb offline CRDT | 0009 |
| [collab.md](collab.md) | Yjs + y-websocket base collaboration | 0009, 0039 |
| [colocated-ipc.md](colocated-ipc.md) | Cross-surface messaging ladder | 0051 |
| [command-palette.md](command-palette.md) | bits-ui Command + tinykeys registry | 0015, 0025 |
| [connectrpc.md](connectrpc.md) | ConnectRPC + buf codegen + streaming | 0038 |
| [consent-management.md](consent-management.md) | GDPR/CCPA banner (Klaro) + SSR consent + IAB TCF | 0019, 0034 |
| [content-moderation.md](content-moderation.md) | Triage classifier + human review queue + DSA-compliant appeals + transparency report | 0023, 0045 |
| [cookies-authoritative.md](cookies-authoritative.md) | Set-Cookie attribute matrix (`__Host-`/SameSite/CHIPS) | 0034 |
| [cron-jobs.md](cron-jobs.md) | HTTP-triggered + `croner` escape + idempotent-execution + overlap locks | 0019, 0023 |
| [csrf-double-submit.md](csrf-double-submit.md) | Origin-check + SameSite=Lax + HMAC-bound double-submit token + Superforms/openapi-fetch wiring + rejection audit | 0034, 0019 |
| [data-migrations.md](data-migrations.md) | Forward-only + zero-downtime + expand/contract + backfill worker | 0019, 0023 |
| [data-tables.md](data-tables.md) | Virtualized `DataTable<T>` + a11y grid | 0011, 0024 |
| [email-deliverability.md](email-deliverability.md) | SPF/DKIM/DMARC + RFC 8058 one-click + bounce/complaint webhook + suppression | 0019 |
| [error-boundaries.md](error-boundaries.md) | SvelteKit `+error.svelte` + ProblemError + handleError hooks | 0019 |
| [feature-flag-rollout-patterns.md](feature-flag-rollout-patterns.md) | Percentage + targeting + kill-switch + staged rollback + SLO guards | 0019, 0023 |
| [feature-flags.md](feature-flags.md) | OpenFeature + cookie-pinned SSR + exposure events | — |
| [file-system-access.md](file-system-access.md) | Disk read/write via File System Access API | — |
| [flow-advanced.md](flow-advanced.md) | Smart routing + collision drop + undo | 0004 |
| [flow-basics.md](flow-basics.md) | `@xyflow/svelte` + elkjs layout | 0004, 0010 |
| [forms.md](forms.md) | Superforms v2 + Formsnap decision flow | 0003 |
| [gdpr-data-export.md](gdpr-data-export.md) | GDPR Art.20 portability + categorized JSON+CSV + media bundle + manifest+SHA-256 + signed-URL 72h | 0034, 0023 |
| [histoire-stories.md](histoire-stories.md) | Story authoring + visual-regression anchor | 0031, 0047 |
| [http-client.md](http-client.md) | openapi-fetch + problem+json + Idempotency-Key | 0019 |
| [i18n-runtime-strategy.md](i18n-runtime-strategy.md) | Paraglide v2 strategy + logical properties | 0017, 0040 |
| [image-optimization.md](image-optimization.md) | `@sveltejs/enhanced-img` + Sharp runtime + AVIF/WebP/JPEG + responsive srcset + LQIP | 0005, 0041 |
| [incident-response.md](incident-response.md) | Status page + on-call + escalation matrix + post-mortem template + customer-comms templates + GameDay drills | 0019, 0023 |
| [internationalization-routing.md](internationalization-routing.md) | Path-prefix routing + hreflang + geo-redirect + `__Host-locale` | 0017, 0040 |
| [job-scheduling-advanced.md](job-scheduling-advanced.md) | Distributed locks + fan-out/fan-in + durable timers + human-in-loop signals (Temporal/Inngest) | 0019, 0023 |
| [kubernetes-deployment.md](kubernetes-deployment.md) | K8s manifests + HPA + PDB + 3-tier probes + ExternalSecrets + NetworkPolicy + distroless + Argo Rollouts | 0019, 0023 |
| [legal-pages.md](legal-pages.md) | Versioned ToS/Privacy/Cookie/DPA authoring + body-hash acceptance records + material-change re-prompt + diff viewer | 0023, 0034 |
| [markdown.md](markdown.md) | `marked` runtime + `mdsvex` build split | 0026 |
| [marketplace-payouts.md](marketplace-payouts.md) | Stripe Connect revenue share + application_fee + clawback on refund + DAC7/1099-K filing + payout holds | 0019, 0023 |
| [media-player.md](media-player.md) | `vidstack@next` + `hls.js` | 0042 |
| [mfa.md](mfa.md) | Structured MFA errors + challenge UI | 0019, 0036 |
| [monorepo-releases.md](monorepo-releases.md) | release-please per-package + provenance | — |
| [multi-region-deployment.md](multi-region-deployment.md) | Active-active vs primary-replica vs tenant-pinned + geo-routing 307 + replication-lag health-checks + manual-failover playbook | 0019, 0023 |
| [notifications-center.md](notifications-center.md) | In-app inbox + read-state + batching + digest + channel routing | 0037, 0019 |
| [oauth-app-marketplace.md](oauth-app-marketplace.md) | Third-party app marketplace + install flow + scoped tokens + rate-limit per-app + uninstall-and-purge | 0032, 0034 |
| [oauth-provider.md](oauth-provider.md) | Be-the-OIDC-provider via Ory Hydra + consent UI + PKCE S256 + JWKS rotation + scope-to-claims discipline | 0032, 0034 |
| [observability.md](observability.md) | OTel + UUIDv7 + RFC 9457 cross-cutting | 0023 |
| [offline-first.md](offline-first.md) | IndexedDB layer + optimistic mutations + conflict resolution + manual-merge UI | 0028, 0009 |
| [onboarding.md](onboarding.md) | Progressive-disclosure + first-run state-machine + flag-rollout | 0019, 0023 |
| [opentelemetry-logs.md](opentelemetry-logs.md) | OTel Logs API migration from structured helper | 0023 |
| [passkeys.md](passkeys.md) | `@simplewebauthn/browser` ceremonies | 0033, 0036 |
| [payments.md](payments.md) | Stripe Elements/Checkout + webhook-driven reconciliation | 0019 |
| [pdf-generation.md](pdf-generation.md) | Tier-1 PDFKit/pdf-lib default + Tier-2 Playwright opt-in + PDF/UA-1 tagging + content-addressed cache + signed URLs | 0019, 0023, 0041 |
| [permissions.md](permissions.md) | `load`-derived + `usePermissions` rune | 0035 |
| [playwright-visual.md](playwright-visual.md) | Playwright + Lost-Pixel snapshot lanes | 0031, 0049 |
| [pricing-plans-changes.md](pricing-plans-changes.md) | Plan upgrade/downgrade mid-cycle + proration preview + grandfathering + dunning cadence + cancel flow | 0019, 0023 |
| [primitives-direct.md](primitives-direct.md) | bits-ui + tailwind-variants escape | 0014 |
| [primitives-shadcn.md](primitives-shadcn.md) | shadcn-svelte CLI default path | 0002, 0014 |
| [progressive-enhancement.md](progressive-enhancement.md) | Forms + navigation that work without JS + SvelteKit actions + `use:enhance` + no-JS Playwright gate | 0019, 0003 |
| [pwa.md](pwa.md) | `@vite-pwa/sveltekit` service worker + manifest | 0028 |
| [queue-workers.md](queue-workers.md) | BullMQ default + Inngest/Trigger.dev escapes + idempotent consumers + DLQ | 0019, 0023 |
| [rate-limiting.md](rate-limiting.md) | Redis token-bucket + RFC 9530/9457 headers + fail-open | 0019 |
| [rbac-modeling.md](rbac-modeling.md) | Role/permission/scope/condition ladder + `authorize()` pure function + policy-engine escape | 0035, 0036 |
| [realtime-collab-comments.md](realtime-collab-comments.md) | Threaded comments on CRDT doc + `RelativePosition` anchors + mentions + resolve-flow + orphan view | 0009, 0037, 0023 |
| [realtime-presence.md](realtime-presence.md) | Yjs Awareness + cursor + selection + view-only SSE presence + reaper + Redis fan-out + reduced-motion respect | 0009, 0037 |
| [referral-program.md](referral-program.md) | Invite-codes + first-touch attribution + `__Host-ref` + qualifying-event reward + 90-day reversal + fraud score | 0019, 0023, 0034 |
| [safe-area.md](safe-area.md) | Tailwind 4 safe-area + `dvh`/`svh` | 0029, 0040 |
| [schemas.md](schemas.md) | Zod v4 patterns at every boundary | 0001 |
| [search-autocomplete.md](search-autocomplete.md) | Combobox + listbox + `aria-activedescendant` + debounced + request-seq + recent queries | 0019, 0031 |
| [search.md](search.md) | Typesense default + SSR pre-render + Postgres-FTS escape | 0019 |
| [secrets-management.md](secrets-management.md) | `$env/static/private` Zod-boundary + Infisical default + rotation + redaction | 0019, 0005 |
| [sentio-config.md](sentio-config.md) | Typed `$sentio` virtual module + `defineSentioConfig` Zod schema + ambient types | 0005 |
| [sentry-or-equivalent.md](sentry-or-equivalent.md) | Error tracking (Sentry/GlitchTip/Highlight) complementary to OTel | 0023 |
| [server-state.md](server-state.md) | TanStack Query v6 vs module `$state` | 0008 |
| [signed-urls.md](signed-urls.md) | S3/R2/GCS pre-signed URLs + TTL policy + content-type pinning + IP binding + key-rotation revocation | 0041, 0034 |
| [social-share-cards.md](social-share-cards.md) | Open Graph + Twitter Card + dynamic OG image via `@vercel/og` + content-addressed cache + per-locale variants | 0005, 0023 |
| [service-limits.md](service-limits.md) | Per-tenant quotas + soft/hard thresholds + RFC 9457 402 envelope | 0019, 0023 |
| [session-replay.md](session-replay.md) | OpenReplay default + consent-gated C2 + PII scrubbing + sampling | 0019, 0023 |
| [sse.md](sse.md) | Native `EventSource` + `useSSE` runes wrapper | 0037 |
| [sso-saml.md](sso-saml.md) | WorkOS default + Ory Hydra escape + per-tenant IdP + JIT + SCIM 2.0 | 0032, 0034 |
| [status-page.md](status-page.md) | Public status page + isolated deploy + S3 snapshot + double-opt-in subscribe + 90-day uptime + Atom feed | 0019, 0023 |
| [structured-emails.md](structured-emails.md) | mjml-svelte transactional email + plain-text + Postmark | 0019 |
| [tenant-custom-domains.md](tenant-custom-domains.md) | CNAME + TXT verification + Caddy on-demand TLS + `ask` gate + `__Secure-` cookies + OIDC URI update | 0050, 0034 |
| [tenant-provisioning.md](tenant-provisioning.md) | Self-serve tenant creation + plan + seed + first-admin + saga compensations | 0035, 0023 |
| [tenant-theming.md](tenant-theming.md) | Per-tenant resolver + SSR style injection | 0050 |
| [theming-flash-free.md](theming-flash-free.md) | Cookie + DB hybrid dark-mode resolution | 0048 |
| [theming.md](theming.md) | oklch tokens + three-tier overrides | 0005, 0006, 0046, 0047 |
| [toast.md](toast.md) | svelte-sonner + preset sizing + ProblemError | 0007, 0016, 0030, 0047 |
| [trusted-types.md](trusted-types.md) | CSP + DOMPurify browser-enforced policies | 0026 |
| [uploads-uppy.md](uploads-uppy.md) | Uppy Dashboard opt-in with validation pipeline | 0041 |
| [uploads.md](uploads.md) | Headless `validate → strip → upload` via tus | 0041 |
| [video-streaming.md](video-streaming.md) | HLS/DASH + ABR + optional DRM (Widevine/FairPlay/PlayReady) + signed CDN cookies + WebVTT thumbnails + QoE telemetry | 0042, 0023 |
| [web-push.md](web-push.md) | `PushManager` + VAPID + SW handlers | 0028, 0034 |
| [webauthn-attestation.md](webauthn-attestation.md) | Direct/enterprise attestation + FIDO MDS3 | 0033 |
| [webgpu-rendering.md](webgpu-rendering.md) | Threlte v8 + raw WebGPURenderer + WGSL compute + adapter-feature probe + render-budget enforcement + WebGL2 fallback | 0042, 0044 |
| [webhooks-outbound.md](webhooks-outbound.md) | Sender-side HMAC-signed + retries + SSRF-defense + subscription UI | 0019, 0023 |
| [webhooks.md](webhooks.md) | Inbound HMAC-signed receiver + replay protection + dedup | 0019 |
| [websocket.md](websocket.md) | `partysocket` opt-in for ad-hoc bidi JSON | 0038 |

**116 recipes.** New entries land in batches; see session log in
[.workingdir/STATE.md](../../.workingdir/STATE.md) for history.

## Relation to `@sveltesentio/*` wrappers

Every recipe falls into one of three buckets:

1. **Pure compose** (majority) — the library composes cleanly, no
   wrapper exists. Recipe is the sole source of pattern truth.
2. **Thin wrapper + compose** — a narrow `@sveltesentio/*` wrapper
   justifies its existence via a cross-cutting invariant (preset
   sizing, a11y envelope, structured errors). Recipe documents both
   the wrapper API and the underlying library.
3. **Held opt-in** — library recipe exists but is not locked into the
   stack. A downstream app must promote it via a concrete need + ADR
   amendment.

Table of recipes in each bucket:

| Bucket | Recipes |
|---|---|
| Pure compose | `http-client`, `sse`, `connectrpc`, `websocket`, `background-sync`, `web-push`, `file-system-access`, `forms` (composes Superforms/Formsnap directly after ADR-0003), `charts-realtime`, `ai-streaming`, `ai-vercel-sdk`, `ai-vercel-sdk-agents`, `ai-on-device`, `ai-in-browser-llm`, `permissions`, `passkeys`, `monorepo-releases`, `clock-injection`, `colocated-ipc`, `schemas`, `markdown`, `trusted-types`, `histoire-stories`, `playwright-visual`, `theming-flash-free`, `tenant-theming`, `safe-area`, `primitives-shadcn`, `primitives-direct`, `server-state`, `collab`, `collab-persistence`, `collab-p2p`, `flow-basics`, `flow-advanced`, `media-player`, `uploads`, `uploads-uppy`, `i18n-runtime-strategy`, `a11y-audit-runbook`, `pwa`, `observability` |
| Thin wrapper justified | `charts` (`@sveltesentio/ui/chart` a11y envelope), `toast` (`@sveltesentio/ui/toast` preset sizing + ProblemError), `command-palette` (`@sveltesentio/ui/cmd` registry), `data-tables` (`@sveltesentio/ui/data` virtualization + a11y grid), `carousel` (`@sveltesentio/ui/carousel` preset target-size), `mfa` (`@sveltesentio/auth/mfa` structured errors), `ai-audit-hook` (`@sveltesentio/ai/audit` event hook), `auth-oidc` (`@sveltesentio/auth/oidc` Golusoris relay), `theming` (`@sveltesentio/ui/preset` token bridge) |
| Held opt-in | `charts-exotic` (svelte-echarts — per-app until concrete need) |

**The streamlining rule** ([principles.md](../principles.md)): prefer
pure-compose whenever possible. A wrapper proposal must cite a
cross-cutting invariant that truly justifies the maintenance cost.

## Recipe authoring conventions

When writing a new recipe:

1. **File name**: kebab-case, noun-phrase (`uploads-uppy.md` not
   `HowToUploadWithUppy.md`). Library-specific recipes prefix with
   the concept (`ai-vercel-sdk.md`, `charts-realtime.md`).
2. **Section order**: intro → Related → When-to-use matrix → Install
   → Reference pattern → sub-concerns (tokens, a11y, testing) →
   Anti-patterns → References.
3. **Governing ADR citation in intro** — the first paragraph states
   "per [ADR-####](...)".
4. **Related section** links to every sibling recipe and the
   governing ADRs. Make the graph walkable.
5. **Anti-patterns section is mandatory** — at minimum 5 entries.
   Name specific mistakes, not vague platitudes.
6. **References section** closes with: ADRs, sibling recipes, upstream
   spec / docs URLs. Never bare URLs without context.
7. **Code examples**: Svelte 5 runes only (`$state` / `$derived` /
   `$effect` / `$props`), TypeScript, no `$:` reactive statements.
8. **A11y invariants**: every UI recipe names the SR role, the
   keyboard contract, and the motion/theme media-query gates.
9. **Security invariants**: name Zod at every boundary, Idempotency-Key
   where applicable, CSP additions if any.
10. **Markdown-linter clean**: no `|` inside backticks in table cells
    (use `/`), no literal `<element>` text (use `element` or alternate
    delimiter), plain quotes not escaped.

## History

Batches 1–17 landed 2026-04-17 to 2026-04-18. See
[.workingdir/STATE.md](../../.workingdir/STATE.md) "docs/compose/
expansion batch N LANDED" entries for detailed per-recipe summaries +
cross-links established per batch. New recipes continue on demand.
