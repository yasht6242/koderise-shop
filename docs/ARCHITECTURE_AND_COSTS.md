# KodRise Tech — Architecture and Costs (Phase 1)

**Audit date:** 2026-10-19  
**Audience:** Beginner developer working locally now, planning for production later.  
**Pricing note:** Exact current provider prices require verification on vendor sites at purchase time. Amounts below are **directional only** or marked **verify**.

---

## 1. Executive recommendation (keep current stack)

**Stay on the existing Shopify React Router + Node.js + Prisma architecture.** It matches Shopify’s current recommended app template, already implements OAuth/sessions/webhooks/app proxy, and has working back-in-stock code. Replacing frameworks now would discard tested progress without product benefit.

| Layer | Keep for now | Evolve before / at production |
| --- | --- | --- |
| App framework | React Router 7 + `@shopify/shopify-app-react-router` | Keep |
| UI | Polaris web components + App Bridge | Keep; replace template demo pages with product UI |
| Language | JS today + TS tooling available | Optionally migrate new files to TypeScript incrementally |
| ORM | Prisma | Keep |
| Local DB | SQLite | Keep for local only |
| Production DB | — | PostgreSQL (managed) |
| Email | Resend | Keep for MVP email; verify deliverability/domain |
| Queue | DB table + inline/manual retry | Add scheduled worker before serious volume |
| Hosting | Local `shopify app dev` | Choose one host later (Fly / Render / Cloud Run / similar) — **approval required** |

---

## 2. Comparison: current architecture vs alternatives

### 2.1 React Router + Node vs alternatives

| Option | Pros | Cons | Verdict |
| --- | --- | --- | --- |
| **Current: React Router Shopify template** | Official path; embedded auth helpers; webhook/app proxy patterns; already built | Newer than Remix template; learning curve | **Keep** |
| Remix Shopify template | Mature docs historically | You already migrated/forked to RR; switching is rewrite risk | Avoid |
| Separate Next.js admin + Nest/Express API | Familiar to some teams | Dual deploy, custom Shopify auth, more moving parts | Avoid for MVP |
| Laravel / Rails / Python | Fine generally | Poor fit for Shopify’s JS-first app templates and App Bridge examples | Avoid |

**Why suitable:** Back-in-stock needs Admin GraphQL, webhooks, app proxy, and an embedded admin — all first-class in this template.

### 2.2 Prisma + SQLite vs production database

| Option | Pros | Cons | When |
| --- | --- | --- | --- |
| **SQLite (current)** | Zero ops; fine for single local process | Bad for multi-instance; file locking; weak concurrent writes | Local only |
| **PostgreSQL + Prisma** | Standard for Shopify apps; concurrent safe; managed free tiers exist | Small migration effort; hosting cost later | **Required before multi-instance production** |
| MySQL / PlanetScale-style | Viable | Slightly less common in Shopify examples | Acceptable alternative |
| MongoDB | Flexible docs | Weaker relational fit for subscriptions/queue; Prisma Mongo caveats | Avoid for this domain |

**Already implemented:** Prisma models for sessions, subscriptions, processed webhooks, inventory state, notification queue.  
**Necessary before production:** Switch datasource to Postgres (or MySQL), use `DATABASE_URL` env, run migrations against hosted DB, ensure persistent volume is **not** the only strategy if scaling horizontally.

### 2.3 Direct webhook processing vs durable queue + worker

| Approach | Pros | Cons | Verdict |
| --- | --- | --- | --- |
| **Current hybrid:** webhook records state, creates notification rows, sends emails inline; manual retry | Simple; durable rows; claim locks | Webhook latency; crash after state update can skip queue; no auto-retry | OK for early dev |
| Queue-only in webhook (enqueue, return 200), worker sends | Faster webhook ACK; better scale | Needs always-on worker/scheduler | **Target before higher volume** |
| Redis + BullMQ / similar | Strong retries, concurrency, dashboards | Extra infra + cost + ops | Wait until scale requires it |
| Serverless queues (SQS, Cloud Tasks) | Managed | Vendor lock-in; wiring complexity | Optional later |

**Already implemented:** `BackInStockNotification` with statuses, unique restock key, attempt counter, exponential backoff in retry helper.  
**Necessary before production:** Automated periodic retry (cron/scheduler) so `FAILED` / stale `SENDING` recover without a merchant clicking a button.  
**Can wait:** Redis/BullMQ until notification volume or multi-instance contention justifies it.

### 2.4 Manual retries vs automated retries

| Approach | Status |
| --- | --- |
| Manual `POST /app/retry-notifications` | Implemented |
| Platform cron (e.g. host cron hitting a secured endpoint) | Not implemented — recommended next |
| External worker process | Not implemented — later |

---

## 3. What is already implemented

- Shopify embedded app scaffold (CLI, toml, Dockerfile, Vite).  
- OAuth/session storage via Prisma.  
- Theme app extension + App Proxy customer subscribe flow.  
- Inventory webhook → stock transition → Resend email path.  
- Notification queue model with claim/retry helpers.  
- Merchant subscription create/list/cancel.  
- Duplicate Shopify webhook ID table.  
- Basic HTML escaping in email body.

---

## 4. What is necessary before production

1. **PostgreSQL (or equivalent)** + env-based `DATABASE_URL`.  
2. **Automated retry scheduler** for notification jobs.  
3. Fix **critical security** issues (unauthenticated test-email route; uninstall data deletion; proxy abuse limits).  
4. **Harden restock durability** (do not mark “already in stock” without durable jobs; document remaining at-least-once email semantics).  
5. **Least-privilege scopes** (drop unused template write scopes when demos removed).  
6. **Secrets hygiene:** `.env.example` with placeholders; fix `.gitignore` so example is commit-able.  
7. **Automated tests** for subscribe, restock transition, idempotent webhooks, retries.  
8. **Hosting + HTTPS app URL** registered in Partner Dashboard (deploy only with approval).  
9. **Monitoring/error tracking** (even a free tier).  
10. **Email domain authentication** (SPF/DKIM for Resend sending domain) — verify Resend docs.  
11. Product clarity: MVP = email BIS only vs also preorder/wishlist/low-stock/SMS.

---

## 5. What can wait until scale requires it

- Redis / BullMQ / dedicated queue cluster.  
- Multi-region hosting and read replicas.  
- SMS / WhatsApp / web push providers.  
- Marketing ESP sync (Klaviyo, Omnisend, Mailchimp).  
- Advanced analytics warehouse.  
- Shopify Functions for complex preorder checkout rules (until preorder is designed).  
- Horizontal autoscaling beyond one app instance (after Postgres + externalized sessions/files).

---

## 6. Hosting approaches (high level)

| Approach | Fit | Cost posture | Notes |
| --- | --- | --- | --- |
| Local `shopify app dev` | Development | Free | Current path |
| Fly.io | Small production | Free allowance then paid — **verify** | Shopify has Fly guidance |
| Render | Small production | Free/paid tiers — **verify** | Docker-friendly |
| Google Cloud Run | Production | Usage-based — **verify** | Shopify has a detailed tutorial for this template |
| Railway / similar PaaS | Small production | Usage-based — **verify** | Simple DX |
| AWS ECS/Fargate | Larger | Higher complexity/cost — **verify** | Overkill for MVP |
| Vercel-only | Poor default | — | Long webhook/worker + Prisma SQLite patterns are awkward; not recommended as sole host |

**Do not create cloud resources or deploy without explicit approval.**

---

## 7. Free / local options

| Need | Free/local option |
| --- | --- |
| App runtime | `shopify app dev` + Cloudflare tunnel (CLI) |
| Database | SQLite file locally |
| Email testing | Resend test addresses / free tier — **verify current limits** |
| Theme testing | Shopify development store (Partner) |
| Lint/typecheck | Local npm scripts |
| Error tracking | Sentry / similar free tiers — **verify** |
| Uptime | Better Stack / UptimeRobot free tiers — **verify** |
| CI | GitHub Actions free minutes for private/public — **verify** |

---

## 8. Potential recurring / usage-dependent costs

Mark all figures as **verify before purchase**.

| Service | Why needed | Cost character |
| --- | --- | --- |
| Shopify Partner / app | Required | App listing later may have requirements; Partner account typically free — **verify** |
| Hosting (Fly/Render/Cloud Run/etc.) | Run Node app 24/7 | Monthly base + usage — **verify** |
| Managed PostgreSQL | Production data | Monthly or usage — **verify**; some free tiers exist with limits |
| Resend (email) | BIS emails | Free tier then per-email — **verify** |
| SMS / WhatsApp (if pursued) | Optional channels | Per-message, country-dependent — **verify**; often the largest variable cost |
| Push provider (if pursued) | Optional | Plan or MAU based — **verify** |
| Redis (if pursued) | Optional queue | Monthly — **verify** |
| Error tracking / logs | Ops | Free then paid — **verify** |
| Domains / email DNS | Deliverability | Domain registrar fees — **verify** |
| CI minutes | Quality gates | Usually free until limits — **verify** |

**Reference app pricing (context only, not our pricing):** Notify Me! public listing shows a free Lite plan with low usage caps and paid plans starting around marketing-listed monthly amounts — **verify on App Store**; not a requirement for our billing model.

---

## 9. Background processing recommendation (phased)

### Phase A — now / next reliability work (minimal)

1. Keep `BackInStockNotification` as source of truth.  
2. Prefer **enqueue-first** (create PENDING rows) before committing “in stock / notified cycle complete” semantics.  
3. Add a **secured scheduled job** (host cron or Shopify-compatible scheduler) calling the same retry logic as `/app/retry-notifications`.  
4. Keep webhook under a few seconds by optionally sending only a small batch inline and leaving the rest to the scheduler.

### Phase B — when volume grows

1. Move sends fully off the webhook request.  
2. Introduce Redis/BullMQ or a managed queue if DB polling becomes insufficient.  
3. Add concurrency limits aligned with Resend rate limits (**verify**).

### Delivery guarantee (honest)

Email provider + database cannot be one atomic transaction. Target:

- **At-least-once** delivery with low duplicate rate.  
- Dedup keys for “one job per subscription per restock”.  
- Accept residual duplicate-email risk if provider accepts mail but DB fails to mark `SENT`; mitigate later with stored provider message IDs / idempotency keys if Resend supports them (**verify**).

---

## 10. Answers to PDF stack questions (concise)

| # | Topic | Recommendation |
| --- | --- | --- |
| 1–3 | Frontend / backend | React 18 + React Router 7 (Shopify template), Polaris web components, App Bridge, Node.js 20+; TypeScript optional incremental |
| 4 | CLI & config | Shopify CLI + `shopify.app.toml` app-specific webhooks; `shopify app dev` for local |
| 5 | APIs | Admin GraphQL + webhooks + app proxy for MVP; Storefront API / Functions only if preorder/wishlist design requires them |
| 6 | Database | Prisma; SQLite local; PostgreSQL production |
| 7 | Auth | `@shopify/shopify-app-react-router` + Prisma session storage |
| 8 | Webhooks & jobs | App-specific webhooks; DB-backed notification queue; scheduled retries; Redis later if needed |
| 9 | Hosting | Defer choice; Docker already present; prefer a Shopify-documented host |
| 10 | Other services | Resend for email MVP; add SMS/push only with approval; add Sentry-class monitoring before production |

---

## 11. Decisions requiring your approval

1. Confirm MVP scope: **email back-in-stock only** vs include preorder / wishlist / low-stock in near-term phases.  
2. Confirm whether “100% as-is” requires installing Notify Me! and matching UI, or functional parity is enough.  
3. Approve Phase 2 reliability + tests before new modules.  
4. Approve any paid services (hosting, SMS, upgraded Resend, Redis).  
5. Approve production database migration approach when ready (no destructive resets without consent).  
6. Approve removal or lockdown of `/app/test-email` and cleanup of template demo scopes/UI.
