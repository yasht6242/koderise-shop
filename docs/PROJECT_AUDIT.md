# KodRise Tech — Project Audit (Phase 1)

**Audit date:** 2026-10-19  
**Repository:** `D:\shopify development\koderise-shopi-dev`  
**Scope:** Read-only inspection of code, config, Prisma schema/migrations, theme extension, and the requirements PDF. No application code, schema, env, Shopify config, or dependencies were modified for this audit.  
**Git state:** Branch `main` with **no commits yet**; entire project is untracked. Existing local work must be preserved carefully.

---

## 1. Requirements sources

### 1.1 Project PDF

Located outside the repo at:

`C:\Users\yasht\Downloads\KodRise Tech – Shopify App Development.pdf`

(Not present inside the workspace.)

**What the PDF actually contains:** It is primarily an **architecture / stack recommendation questionnaire**, not a detailed feature specification. It instructs the team to:

- Build the app **“100% as-is”** relative to the reference app’s **core functionality and user flow**.
- Install and properly test/review the reference app on a development store first.
- Reference app: [Notify! Back in Stock+Wishlist](https://apps.shopify.com/preorder-back-in-stock) (“Notify Me!”).
- Cover main features: customer flow, merchant dashboard, settings, notifications, widgets, pre-order, back-in-stock, wishlist, low-stock, and reporting.
- Answer stack questions (frontend, backend, CLI/template, APIs, database/ORM, auth/sessions, webhooks/background processing, hosting/deployment, and supporting services such as email/SMS/push/monitoring).

**Implication:** Feature acceptance criteria must come from (a) verified reference-app behavior and (b) explicit product decisions. This audit treats the PDF feature list as **target modules**, not as verified UX specs.

### 1.2 Reference app (public documentation only)

Public help overview used for high-level module names only (not installed or tested in this audit):

- Modules: **Back in Stock**, **PreOrder**, **Wishlist**, **Low Stock**
- Typically theme **App Embed**, merchant toggles per module, restock-triggered alerts, preorder checkout flow, wishlist for guests/customers, low-stock storefront counter + optional merchant low-stock email
- Channels mentioned publicly for Notify Me!: Email, SMS, Push, WhatsApp (SMS/WhatsApp are paid/usage-based)

**Limitation:** Reference app was **not** installed or exercised on a development store during this audit. Do not treat public marketing/help text as a verified parity checklist.

### 1.3 User-reported local testing (unverified in this audit)

The following are treated as claimed local successes to verify later with automated tests; they were **not** re-run during Phase 1:

1. Storefront back-in-stock subscription flow  
2. Subscriptions stored in Prisma  
3. Inventory webhook processing  
4. Out-of-stock → in-stock transitions  
5. Resend email delivery  
6. Notification queue statuses (`PENDING`, `SENDING`, `SENT`, `FAILED`)  
7. Manually triggered retry worker / protected retry route  
8. Duplicate webhook protection via `ProcessedWebhook`

---

## 2. Current framework and package versions

| Area | Version / choice | Evidence |
| --- | --- | --- |
| App name | `koderise-shopi-dev` | `package.json` |
| Node engines | `>=20.19 <22 \|\| >=22.12` | `package.json` |
| React Router | `7.18.2` | `@react-router/*`, `react-router` |
| React | `^18.3.1` | `package.json` |
| Shopify app package | `@shopify/shopify-app-react-router` `^1.2.1` | `package.json` |
| App Bridge React | `^4.2.4` | `package.json` |
| Session storage | `@shopify/shopify-app-session-storage-prisma` `^9.0.0` | `package.json`, `app/shopify.server.js` |
| Prisma / client | `^6.16.3` | `package.json` |
| DB (local) | SQLite `file:dev.sqlite` | `prisma/schema.prisma` |
| Email | `resend` `^6.34.0` | `package.json`, `app/services/email.server.js` |
| Vite | `^6.3.6` | `package.json` |
| TypeScript | `^5.9.3` (present; app routes are mostly `.jsx`) | `package.json` |
| Shopify Admin API version (app) | `ApiVersion.July26` | `app/shopify.server.js` |
| Webhooks API version (toml) | `2027-01` | `shopify.app.toml` |
| Distribution | `AppDistribution.AppStore` | `app/shopify.server.js` |
| Template leftovers | product metafield / metaobject demo, “Generate a product” | `shopify.app.toml`, `app/routes/app._index.jsx` |

**Scripts available:** `dev`, `build`, `start`, `setup`, `lint`, `typecheck`, `docker-start`, Shopify CLI helpers. **No `test` script.**

---

## 3. Repository structure (application-relevant)

```
app/
  shopify.server.js          Shopify auth + app config
  db.server.js               Prisma client singleton
  services/
    email.server.js          Resend back-in-stock email
    notifications.server.js  Queue + send + retry worker
  routes/
    proxy.jsx                App proxy subscribe + health
    webhooks.inventory.update.jsx
    webhooks.app.uninstalled.jsx
    webhooks.app.scopes_update.jsx
    app._index.jsx           Home (template + retry UI)
    app.subscriptions.jsx    Merchant subscription CRUD
    app.retry-notifications.jsx
    app.test-email.jsx       Unauthenticated email test
    app.additional.jsx       Product/variant inventory table
    app.jsx                  Embedded shell + nav
    auth.*                   OAuth / login
extensions/back-in-stock-widget/
  blocks/star_rating.liquid  Storefront widget (misnamed file)
  assets/back-in-stock.js
  snippets/stars.liquid      Template leftover (ratings)
prisma/schema.prisma + migrations/
shopify.app.toml, shopify.web.toml, Dockerfile
```

---

## 4. Database models and migrations

### Models (`prisma/schema.prisma`)

| Model | Purpose |
| --- | --- |
| `Session` | Shopify offline/online session + access tokens (Prisma session storage) |
| `BackInStockSubscription` | Customer waitlist: shop, email, productId, variantId, status, notifiedAt |
| `ProcessedWebhook` | Idempotency by Shopify webhook ID |
| `InventoryVariantState` | Last known stock snapshot per shop+variant |
| `BackInStockNotification` | Durable email job queue with status/attempts/restockKey |

### Migrations (chronological)

1. `20240530213853_create_session_table`  
2. `20261016134815_add_back_in_stock_subscription`  
3. `20261019100622_add_subscription_notified_at`  
4. `20261019101818_add_processed_webhooks`  
5. `20261019110228_add_inventory_variant_state`  
6. `20261019113525_add_back_in_stock_notification_queue`

Local SQLite file `prisma/dev.sqlite` exists (gitignored). Row counts were not queried in this audit.

**Schema gaps vs target product:** no models for preorders, wishlist, low-stock settings/thresholds, merchant settings, SMS/push channels, reporting aggregates, or customer GDPR request tracking.

---

## 5. Routes, services, integrations

### 5.1 Customer / storefront

| Piece | Path | Behavior |
| --- | --- | --- |
| Theme block | `extensions/.../blocks/star_rating.liquid` | Email form; merchant-configurable heading/description/button |
| Widget JS | `extensions/.../assets/back-in-stock.js` | POSTs to `/apps/back-in-stock` via App Proxy |
| App proxy | `shopify.app.toml` → `prefix=apps`, `subpath=back-in-stock`, `url=/proxy` | |
| Proxy loader | `app/routes/proxy.jsx` | Authenticated health JSON |
| Proxy action | `app/routes/proxy.jsx` | Validates email + GIDs, verifies variant↔product via Admin GraphQL, dedupes ACTIVE subscription, creates record |

### 5.2 Inventory → email pipeline

| Piece | Path | Behavior |
| --- | --- | --- |
| Webhook | `inventory_levels/update` → `/webhooks/inventory/update` | HMAC via `authenticate.webhook` |
| Idempotency | `ProcessedWebhook` create; P2002 → 200 ignore; delete on processing failure | |
| Stock resolve | Admin GraphQL: inventory item → variant → quantity + `availableForSale` | |
| Transition | Compare `InventoryVariantState`; first sighting initializes without email; OOS clears `notifiedAt`; restock queues/sends | |
| Queue/send | `queueRestockNotifications` | Create `PENDING` (unique on subscriptionId+restockKey), claim → `SENDING`, Resend, then `SENT` + set `notifiedAt` |
| Retry | `retryFailedNotifications` + `POST /app/retry-notifications` (admin auth) | FAILED + stale SENDING (>10 min), max 5 attempts, exponential backoff |

### 5.3 Merchant admin UI

| Route | Role |
| --- | --- |
| `/app` | Template home + **manual** “Run notification retries” |
| `/app/subscriptions` | List/create/cancel back-in-stock subscriptions (not linked in `s-app-nav`) |
| `/app/additional` | Product/variant inventory table (debug-ish) |
| `/app/retry-notifications` | Action-only retry worker |
| `/app/test-email` | Sends Resend test email — **no auth** |

Nav currently: Home, Additional page only (`app/routes/app.jsx`).

### 5.4 Other webhooks

- `app/uninstalled` — deletes `Session` rows only; **does not** delete subscriptions/notifications/inventory state.  
- `app/scopes_update` — updates session scope string.

### 5.5 Email

- Provider: Resend  
- Env vars used in code: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`  
- HTML escaping for title/URL attributes is present  
- Subject line uses raw `productTitle` (not escaped; lower risk than HTML body)

---

## 6. Authentication, authorization, webhook verification

| Concern | Status | Notes |
| --- | --- | --- |
| Embedded admin auth | Implemented | `authenticate.admin` on app loaders/actions |
| OAuth / sessions | Implemented | Prisma session storage; `expiringOfflineAccessTokens: true` |
| App proxy auth | Implemented | `authenticate.public.appProxy` |
| Webhook HMAC | Implemented | `authenticate.webhook` |
| Webhook idempotency | Implemented | `ProcessedWebhook` by `X-Shopify-Webhook-Id` |
| Test email route auth | **Missing** | `app/routes/app.test-email.jsx` has no `authenticate.*` |
| Proxy abuse protection | **Missing** | No rate limit / CAPTCHA / honeypot |
| Least-privilege scopes | **Weak** | Toml includes template scopes (`write_products`, `write_metaobjects`, `write_metaobject_definitions`, `write_app_proxy`, `read_inventory`) — likely more than BIS needs |
| Customer data deletion on uninstall | **Incomplete** | Sessions only |

---

## 7. Existing customer and merchant workflows

### Working (code-complete; local success claimed by user, not re-tested here)

1. Customer submits email on theme widget → App Proxy → subscription row.  
2. Inventory restock webhook → stock transition detection → notification rows → Resend email.  
3. Merchant can create/cancel subscriptions on `/app/subscriptions`.  
4. Merchant can manually run retries from home page.  
5. Duplicate Shopify webhook IDs ignored.

### Partial / fragile

1. Widget always renders (no sold-out / available check in Liquid).  
2. Variant ID is snapshotted at page render; no `variant:change` listener.  
3. Subscriptions page copy still says “Email notifications are not enabled yet” (stale).  
4. Retry is **manual only** — no cron/scheduler/worker process.  
5. Home page still dominated by Shopify template “Generate a product” demo.  
6. Theme extension still contains star-rating leftover assets/snippets/locales.  
7. Delivery is **at-least-once**, not exactly-once (email provider success before DB `SENT` can duplicate on retry).

### Not implemented (no meaningful code)

Pre-orders, wishlist, low-stock badges/alerts, merchant settings module, reporting/analytics, SMS/push/WhatsApp, marketing integrations, production monitoring, automated tests, scheduled background worker.

---

## 8. Tests and commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | `shopify app dev` |
| `npm run build` | `react-router build` |
| `npm run lint` | ESLint |
| `npm run typecheck` | `react-router typegen && tsc --noEmit` |
| `npm run setup` | `prisma generate && prisma migrate deploy` |
| `npm test` | **Does not exist** |

**Automated tests found:** none (`*.test.*` / `*.spec.*` absent).

Phase 1 did **not** run lint/typecheck/build (audit-only; no claim of pass/fail).

---

## 9. Environment and secrets

Env vars referenced in application code:

- `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SCOPES`, `SHOPIFY_APP_URL`, `SHOP_CUSTOM_DOMAIN`  
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL`  
- `NODE_ENV`, plus Vite/CLI: `HOST`, `PORT`, `FRONTEND_PORT`

Observations:

- `.env` exists locally and is gitignored (contents not documented here).  
- **No `.env.example`** in the repo.  
- `.gitignore` contains `.env.*`, which would also ignore a file named `.env.example` unless an exception is added.  
- `shopify.app.toml` contains a `client_id` (normal for Shopify apps; not a secret) and placeholder `application_url` / auth redirect URLs (`https://example.com`).

---

## 10. Errors, bugs, security risks, incomplete areas

### Security

1. **Critical:** Unauthenticated `/app/test-email` can send email if reachable and Resend is configured.  
2. **High:** Uninstall does not delete customer PII (emails) or shop operational data.  
3. **Medium:** App proxy subscription endpoint lacks rate limiting / abuse controls.  
4. **Medium:** Over-broad Admin API scopes from template demos.  
5. **Low:** Stale leftover theme rating snippet/assets increase attack/maintenance surface slightly.

### Reliability (back-in-stock — detail for Phase 2)

1. **Inventory state is persisted before notification jobs are durably queued.** If the process dies after `inventoryVariantState.update` marks in-stock but before `queueRestockNotifications` creates rows, that restock cycle is skipped (next webhook sees `previousState.isInStock === true`).  
2. Webhook ID is recorded up front; on failure it is deleted (good for Shopify retry). Early successful returns keep the ID (good). If work is “half done” (state updated, emails not queued) and the handler returns 200, Shopify will not retry.  
3. **SENDING** crash recovery exists in retry code, but only when someone POSTs `/app/retry-notifications`.  
4. **Duplicate emails:** Resend accept + DB update failure → retry can send again. No provider message-id idempotency key stored.  
5. Max attempts = 5; no distinct dead-letter status beyond `FAILED` with `attempts >= 5`.  
6. Retry of FAILED marks back to FAILED even when skipped for “out of stock again” (counts as failed).  
7. Multi-location: uses variant-level `inventoryQuantity` / `availableForSale`, not per-location logic; location webhook `available` is logged but not used as source of truth.  
8. No Shopify GraphQL throttle/backoff wrapper beyond failing the webhook/retry.  
9. No unique DB constraint on `(shop, email, variantId, ACTIVE)` — race can create duplicate subscriptions.  
10. Concurrent distinct webhook IDs for the same restock can race on state transitions; notification uniqueness is per `restockKey` derived from previous `updatedAt`.

### Product / UX incomplete

1. No merchant settings (enable/disable widget behavior, email templates, thresholds).  
2. No reporting (demand by variant, send success rates).  
3. Preorder / wishlist / low-stock modules absent.  
4. Widget accessibility is basic (has `aria-live`); no out-of-stock gating.  
5. Subscriptions not in app nav.

### Ops / production incomplete

1. SQLite unsuitable for multi-instance production.  
2. Dockerfile present; no CI config found.  
3. No monitoring/error tracking integration.  
4. No scheduled worker.  
5. No production deployment runbooks beyond template README.  
6. Git history empty — collaboration/backup risk.

---

## 11. Assumptions that could not be verified

1. Whether local BIS flows still pass end-to-end today (credentials, tunnel, theme embed, Resend domain).  
2. Exact reference-app UX, edge cases, and merchant settings (app not installed/tested here).  
3. Whether `inventory_levels/update` is registered on the linked Partner app in all environments (toml declares it; remote sync not verified).  
4. Exact contents of `.env` beyond confirming the file exists and that code expects Shopify + Resend variables.  
5. Whether production hosting has been chosen.  
6. Whether SMS/push/WhatsApp are in scope for MVP or only email.  
7. Whether “100% as-is” means strict UI/feature parity with Notify Me! or functional parity of core modules.  
8. Database row/history evidence of past successful sends (not queried in this audit).

---

## 12. Recommended next phase (preview)

See also `FEATURE_CHECKLIST.md` and `ARCHITECTURE_AND_COSTS.md`.

**Recommended Phase 2 (after your approval):** Reliability hardening of the existing back-in-stock pipeline + automated tests — before adding preorder/wishlist/low-stock. Smallest safe plan will be proposed after you approve leaving Phase 1.
