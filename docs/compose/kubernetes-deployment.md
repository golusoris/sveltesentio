# `kubernetes-deployment.md` — Kubernetes deployment recipe for sveltesentio apps

SvelteKit apps in the sveltesentio stack deploy to Kubernetes as a
stateless `Node` runtime behind a load balancer, with a
strictly-bounded Pod contract (readiness + liveness + startup probes,
resource requests + limits, HPA, PodDisruptionBudget, ExternalSecrets,
non-root SecurityContext, network policies) per
[ADR-0019](../adr/0019-server-runtime-contract.md) and
[ADR-0023](../adr/0023-compliance-observability.md). Kubernetes is the
**ops-side interface contract** — the same app image runs on GKE,
EKS, AKS, or self-hosted kubeadm/k3s without per-platform forks.

This recipe covers manifests + auto-scaling + disruption budgets +
probes + secrets + network policy — not the platform itself. Pick a
managed control plane (GKE / EKS / AKS) unless you have operator
staffing. Self-hosted k3s / kubeadm is fine for single-region hobby
deployments but an ops hazard at scale.

## Related

- [secrets-management.md](secrets-management.md) — Infisical/External
  Secrets source-of-truth → Kubernetes `Secret` sync
- [observability.md](observability.md) — OTel collector sidecar / DaemonSet
- [rate-limiting.md](rate-limiting.md) — Redis deployment (separate Helm chart)
- [queue-workers.md](queue-workers.md) — BullMQ worker Deployment
  (separate from web Deployment)
- [backup-recovery.md](backup-recovery.md) — CronJobs for PITR uploads
- [feature-flag-rollout-patterns.md](feature-flag-rollout-patterns.md) —
  SLO-gated rollouts via Argo Rollouts
- [ADR-0019](../adr/0019-server-runtime-contract.md) —
  SvelteKit server-runtime contract
- [ADR-0023](../adr/0023-compliance-observability.md) —
  Observability + OTel
- [ADR-0005](../adr/0005-secrets-boundary.md) — Secrets boundary

## When to use what — decision tree

```text
1 app + hobby budget                         → Fly.io / Railway / Render (skip this recipe)
1 app + staff ops                            → managed K8s (GKE / EKS / AKS)
multi-app + shared platform                  → managed K8s + Argo CD GitOps
multi-region + active-active                 → managed K8s × N regions + multi-region-deployment.md
self-hosted single region                    → k3s + rook-ceph + Flux (hazard at scale)
Strict compliance + on-prem                  → OpenShift (OKD) or bare-metal kubeadm
```

## Install

```bash
# one-shot cluster bootstrap (Helm releases)
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo add external-secrets https://charts.external-secrets.io
helm repo add argo https://argoproj.github.io/argo-helm
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

# cluster-wide operators
helm install ingress-nginx ingress-nginx/ingress-nginx -n ingress-nginx --create-namespace
helm install external-secrets external-secrets/external-secrets -n external-secrets --create-namespace
helm install argocd argo/argo-cd -n argocd --create-namespace
helm install prometheus prometheus-community/kube-prometheus-stack -n monitoring --create-namespace
```

```jsonc
// package.json — container image build
{
  "scripts": {
    "docker:build": "docker buildx build --platform=linux/amd64,linux/arm64 -t ghcr.io/org/app:$(git rev-parse --short HEAD) --push .",
    "kubectl:apply": "kubectl apply -f k8s/ -n production"
  }
}
```

## Shape — bounded Zod contracts for deployment config

```ts
// packages/deploy/src/schema.ts
import { z } from 'zod';

export const Environment = z.enum(['dev', 'staging', 'production']);
export type Environment = z.infer<typeof Environment>;

export const PodResources = z.object({
  requests: z.object({
    cpu: z.string().regex(/^\d+m$/, 'use millicores: "250m"'),
    memory: z.string().regex(/^\d+Mi$/, 'use mebibytes: "512Mi"'),
  }),
  limits: z.object({
    cpu: z.string().regex(/^\d+m?$/),
    memory: z.string().regex(/^\d+Mi$/),
  }),
});

export const DeploymentConfig = z.object({
  appName: z.string().regex(/^[a-z0-9-]+$/).max(40),
  environment: Environment,
  image: z.string().regex(/^ghcr\.io\/.+:[a-f0-9]{7,40}$/, 'use immutable SHA tag, never :latest'),
  replicas: z.object({
    min: z.number().int().min(2, 'HA requires ≥2 pods'),
    max: z.number().int().min(2).max(100),
  }),
  resources: PodResources,
  podDisruptionBudget: z.object({
    minAvailable: z.union([z.number().int().min(1), z.string().regex(/^\d+%$/)]),
  }),
  hpa: z.object({
    targetCpuPercent: z.number().int().min(50).max(90).default(70),
    targetMemoryPercent: z.number().int().min(60).max(90).default(80),
  }),
});
```

## Reference — production Deployment manifest

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: production
  labels:
    app.kubernetes.io/name: web
    app.kubernetes.io/version: "1.14.3"
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app.kubernetes.io/name: web
  template:
    metadata:
      labels:
        app.kubernetes.io/name: web
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "9091"
    spec:
      serviceAccountName: web
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        runAsUser: 65532
        runAsGroup: 65532
        fsGroup: 65532
        seccompProfile:
          type: RuntimeDefault
      terminationGracePeriodSeconds: 60
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: ScheduleAnyway
          labelSelector:
            matchLabels:
              app.kubernetes.io/name: web
      containers:
        - name: web
          image: ghcr.io/org/app:7c4e2f9
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: 3000
              protocol: TCP
            - name: metrics
              containerPort: 9091
              protocol: TCP
          env:
            - name: NODE_ENV
              value: production
            - name: PORT
              value: "3000"
            - name: POD_NAME
              valueFrom:
                fieldRef:
                  fieldPath: metadata.name
          envFrom:
            - secretRef:
                name: web-secrets
          resources:
            requests:
              cpu: "250m"
              memory: "512Mi"
            limits:
              cpu: "1000m"
              memory: "1Gi"
          startupProbe:
            httpGet:
              path: /healthz/startup
              port: http
            failureThreshold: 30
            periodSeconds: 2
          readinessProbe:
            httpGet:
              path: /healthz/ready
              port: http
            periodSeconds: 5
            failureThreshold: 3
            timeoutSeconds: 2
          livenessProbe:
            httpGet:
              path: /healthz/live
              port: http
            periodSeconds: 10
            failureThreshold: 3
            timeoutSeconds: 2
          lifecycle:
            preStop:
              exec:
                command: ["/bin/sh", "-c", "sleep 10"]
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          volumeMounts:
            - name: tmp
              mountPath: /tmp
            - name: cache
              mountPath: /app/.cache
      volumes:
        - name: tmp
          emptyDir: {}
        - name: cache
          emptyDir: {}
```

## Probes — three-tier liveness contract

```ts
// src/routes/healthz/startup/+server.ts
import { json } from '@sveltejs/kit';

// Startup: "have we finished loading?" — pod-level boot
export const GET = async () => {
  if (!globalThis.__ready) return new Response('not ready', { status: 503 });
  return json({ status: 'started' });
};

// src/routes/healthz/ready/+server.ts
// Readiness: "can we serve traffic right now?" — flips with backpressure
import { db } from '$lib/server/db';
import { redis } from '$lib/server/redis';

export const GET = async () => {
  try {
    await Promise.all([
      db.query('SELECT 1'),
      redis.ping(),
    ]);
    return json({ status: 'ready' });
  } catch (e) {
    return new Response('dependency down', { status: 503 });
  }
};

// src/routes/healthz/live/+server.ts
// Liveness: "is the process in a state kubelet should restart?"
// DO NOT check dependencies here — only process-health (no event-loop stall, no deadlock).
export const GET = async () => {
  return json({ status: 'live', pid: process.pid });
};
```

**Liveness MUST NOT hit the database.** If Postgres goes down and
liveness depends on it, kubelet restarts every pod → outage amplified.
Liveness checks process-health only; readiness checks dependencies.

## HPA — horizontal pod auto-scaling

```yaml
# k8s/hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: web
  namespace: production
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: web
  minReplicas: 3
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Percent
          value: 10
          periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 0
      policies:
        - type: Percent
          value: 100
          periodSeconds: 60
        - type: Pods
          value: 4
          periodSeconds: 60
      selectPolicy: Max
```

Scale-up is aggressive (double pods or +4 per minute, whichever is
higher); scale-down is conservative (10% per minute with a 5-minute
stabilization window) so transient dips don't cause
pod-churn-induced cold starts.

## PodDisruptionBudget — outage-floor guarantee

```yaml
# k8s/pdb.yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: web
  namespace: production
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app.kubernetes.io/name: web
```

Node drains (upgrades, cluster scale-down, spot preemptions) respect
`minAvailable`. Without a PDB, a cluster upgrade can evict every web
pod at once → full outage during what should be a zero-downtime
operation.

## Service + Ingress — TLS termination

```yaml
# k8s/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: web
  namespace: production
spec:
  type: ClusterIP
  ports:
    - name: http
      port: 80
      targetPort: http
  selector:
    app.kubernetes.io/name: web
---
# k8s/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web
  namespace: production
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/proxy-body-size: "20m"
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "60"
spec:
  ingressClassName: nginx
  tls:
    - hosts: [app.example.com]
      secretName: web-tls
  rules:
    - host: app.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: web
                port:
                  number: 80
```

## ExternalSecrets — Infisical → Kubernetes `Secret`

```yaml
# k8s/externalsecret.yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: web-secrets
  namespace: production
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: infisical
    kind: ClusterSecretStore
  target:
    name: web-secrets
    creationPolicy: Owner
  data:
    - secretKey: DATABASE_URL
      remoteRef:
        key: /production/DATABASE_URL
    - secretKey: REDIS_URL
      remoteRef:
        key: /production/REDIS_URL
    - secretKey: STRIPE_SECRET_KEY
      remoteRef:
        key: /production/STRIPE_SECRET_KEY
```

Secret **values** live in Infisical (per
[secrets-management.md](secrets-management.md)); Kubernetes holds a
projected copy synced hourly. Rotations in Infisical propagate
automatically — pods re-read envs via a restart triggered by a
`reloader` annotation or wait for natural rollover.

## NetworkPolicy — egress baseline

```yaml
# k8s/networkpolicy.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: web
  namespace: production
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: web
  policyTypes: [Ingress, Egress]
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: ingress-nginx
      ports:
        - port: 3000
  egress:
    # DNS
    - to:
        - namespaceSelector: {}
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - port: 53
          protocol: UDP
    # Postgres
    - to:
        - namespaceSelector:
            matchLabels:
              name: database
      ports:
        - port: 5432
    # Redis
    - to:
        - namespaceSelector:
            matchLabels:
              name: cache
      ports:
        - port: 6379
    # HTTPS egress (limit to specific CIDRs if possible)
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
            except:
              - 169.254.169.254/32 # block cloud metadata SSRF
              - 10.0.0.0/8
              - 172.16.0.0/12
              - 192.168.0.0/16
      ports:
        - port: 443
```

Default-deny is enforced at cluster level; this policy re-opens only
what the web tier needs. Metadata IP (`169.254.169.254`) is blocked
to harden against SSRF-to-cloud-credential attacks.

## ServiceAccount + RBAC

```yaml
# k8s/serviceaccount.yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: web
  namespace: production
automountServiceAccountToken: false
```

`automountServiceAccountToken: false` — web pods have no business
calling the Kubernetes API. If they do (e.g., reading their own pod
metadata for observability), scope a minimal `Role` that grants only
what's needed, never `cluster-admin`.

## Dockerfile — multi-stage + distroless

```dockerfile
# syntax=docker/dockerfile:1.9
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable pnpm && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm prune --prod

FROM gcr.io/distroless/nodejs22-debian12:nonroot AS runtime
WORKDIR /app
COPY --from=builder --chown=nonroot:nonroot /app/build ./build
COPY --from=builder --chown=nonroot:nonroot /app/node_modules ./node_modules
COPY --from=builder --chown=nonroot:nonroot /app/package.json ./package.json
USER nonroot:nonroot
EXPOSE 3000
CMD ["build/index.js"]
```

Distroless = no shell, no package manager, no `apt`, no `curl` → an
attacker who achieves code execution can't pivot via standard
tooling.

## Argo Rollouts — canary / blue-green promotion

```yaml
# k8s/rollout.yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: web
  namespace: production
spec:
  replicas: 10
  selector:
    matchLabels:
      app.kubernetes.io/name: web
  strategy:
    canary:
      steps:
        - setWeight: 10
        - pause: { duration: 5m }
        - analysis:
            templates:
              - templateName: error-rate
              - templateName: latency-p99
        - setWeight: 25
        - pause: { duration: 10m }
        - setWeight: 50
        - pause: { duration: 10m }
        - setWeight: 100
      canaryService: web-canary
      stableService: web-stable
      trafficRouting:
        nginx:
          stableIngress: web
```

Paired with `AnalysisTemplate` definitions that query Prometheus for
error-rate + p99 latency; a regression auto-rolls-back per
[feature-flag-rollout-patterns.md](feature-flag-rollout-patterns.md)
SLO-guard rules.

## Anti-patterns (25)

1. **`image: app:latest`** — mutable tag. Kubernetes won't re-pull on
   rollout; two pods of "the same image" can be different binaries.
   Always pin to a SHA (`app:7c4e2f9`).
2. **No `readinessProbe`** — kubelet sends traffic to pods before the
   app has finished booting → 502s for 10-30s after every deploy.
3. **Liveness probe hits database** — DB outage → every pod restarted
   → outage amplification. Liveness checks process-health only.
4. **No `PodDisruptionBudget`** — node drain evicts all pods at once
   during cluster upgrades.
5. **`replicas: 1`** — single-pod deployments have no HA. Single node
   reboot = full outage. Minimum 2, ideally 3.
6. **No `resources.requests`** — scheduler can't place pods
   correctly; HPA can't compute utilization; noisy-neighbor OOM kills
   random pods.
7. **`resources.limits.cpu` too low** — CPU throttling at p99 causes
   latency spikes invisible to request-count metrics.
8. **`resources.limits.memory == requests.memory`** — Node.js GC
   patterns need 10-20% headroom; exact-equal setting causes OOMKills
   under normal GC.
9. **No `terminationGracePeriodSeconds` + `preStop sleep`** —
   iptables rules lag behind pod-deletion by ~seconds, causing
   in-flight requests to 502.
10. **`runAsUser: 0`** — pod has root. Container escape = node
    compromise. Always `runAsNonRoot: true`.
11. **`readOnlyRootFilesystem: false` without need** — attacker can
    drop tools into `/tmp` and chain exploits. Set true, mount `/tmp`
    as `emptyDir`.
12. **Mounting service account tokens into pods that don't need them**
    — default `automountServiceAccountToken: true` leaks a cluster
    credential to every pod.
13. **No NetworkPolicy** — compromised pod has unrestricted egress to
    metadata IPs, internal services, and the internet.
14. **Hardcoded secrets in ConfigMap** — ConfigMaps are readable by
    any pod in the namespace with default RBAC. Use Secrets (or
    ExternalSecrets).
15. **Secrets committed to git** — sealed-secrets or SOPS offset this
    but external secret managers (Infisical/Vault) are the real
    answer.
16. **HPA only on CPU** — Node.js is I/O-bound; CPU-only HPA
    under-scales during DB-latency spikes. Add memory or custom
    (request-queue-depth) metrics.
17. **`scaleUp.stabilizationWindowSeconds: 300`** — default is 0;
    setting 300 means slow response to traffic spikes. Scale up fast,
    scale down slow.
18. **No `topologySpreadConstraints`** — HPA can schedule all pods on
    one node. That node dies → full outage.
19. **Single AZ cluster for production** — cloud AZ outages do
    happen. Multi-AZ node groups are free; use them.
20. **Ingress without `ssl-redirect: true`** — HTTP requests served
    cleartext; session cookies can leak on coffeeshop WiFi.
21. **Manual `kubectl apply` for production** — no audit trail, no
    rollback, no drift detection. Use GitOps (Argo CD / Flux).
22. **`emptyDir.sizeLimit` unset** — runaway log-write fills node
    disk → eviction cascade.
23. **No PodSecurityAdmission / PodSecurityPolicy** — any pod can
    request privileged mode, host namespaces, writable root fs.
24. **Cluster-admin kubeconfig shared** — least-privilege RBAC per
    developer + audit logs.
25. **Ignoring `CrashLoopBackOff` for >5min** — exponential backoff
    means 10 crashes → 5min wait between restarts; the pod is
    effectively dead. Alert on `kube_pod_container_status_waiting_reason{reason="CrashLoopBackOff"}`.

## References

- ADRs: [0019](../adr/0019-server-runtime-contract.md),
  [0023](../adr/0023-compliance-observability.md),
  [0005](../adr/0005-secrets-boundary.md)
- Sibling recipes:
  [secrets-management.md](secrets-management.md),
  [observability.md](observability.md),
  [feature-flag-rollout-patterns.md](feature-flag-rollout-patterns.md),
  [backup-recovery.md](backup-recovery.md),
  [queue-workers.md](queue-workers.md)
- Upstream:
  Kubernetes docs `kubernetes.io/docs/concepts/workloads/pods/`,
  Pod Security Standards `kubernetes.io/docs/concepts/security/pod-security-standards/`,
  ExternalSecrets `external-secrets.io`,
  Argo Rollouts `argoproj.github.io/argo-rollouts/`,
  Distroless images `github.com/GoogleContainerTools/distroless`,
  CIS Kubernetes Benchmark `www.cisecurity.org/benchmark/kubernetes`.
