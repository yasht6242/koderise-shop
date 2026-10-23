# Phase 2 — Implementation Notes

**Date:** 2026-10-19  
**Scope:** Back-in-Stock reliability, security fix for test email, retry hardening, automated tests with Node’s built-in test runner.  
**Not in scope:** Preorder, wishlist, low-stock, SMS/push, UI/CSS redesign, Postgres migration, Redis/BullMQ, deployment, paid services.

---

## 1. Changes made

### Security
- `app/routes/app.test-email.jsx` now requires Shopify **admin** authentication on both `loader` and `action`.
- Error responses no longer echo raw provider error strings to the client.

### Durability (queue before stock flip)
- New helper: `app/services/inventory-restock.server.js` → `applyVariantStockUpdate`.
- On out-of-stock → in-stock:
  1. Detect restock using previous `InventoryVariantState`
  2. **Create** `BackInStockNotification` jobs (`PENDING`)
  3. **Then** update inventory state to in-stock
  4. Attempt email delivery
- If the process dies after jobs are saved but before the state update, a later webhook still sees “was out of stock” and can re-enter the restock path. Unique `(subscriptionId, restockKey)` prevents duplicate jobs.
- Webhook HMAC verification and `ProcessedWebhook` idempotency are unchanged.

### Notification service
- Split into:
  - `enqueueRestockNotifications` — durable job creation only
  - `deliverRestockNotifications` — claim + send
  - `queueRestockNotifications` — enqueue then deliver (compatibility helper)
- Injectable `dbClient` / `sendEmail` / `getAdmin` for tests (defaults unchanged for production).

### Retry hardening
- Cancelled / missing subscriptions → terminal `FAILED` with `attempts = MAX_NOTIFICATION_ATTEMPTS` (no further emails).
- Missing product variant → same terminal failure.
- Still out of stock → `FAILED` with clear lastError; **no email**; remains retryable until max attempts (so a later restock + manual retry can still succeed).
- Concurrent claim via `updateMany` preserved for deliver + retry.
- Logs use notification IDs / messages only (no customer emails).

### Subscriptions
- New `app/services/subscriptions.server.js` with shared validation + create logic used by the App Proxy route.

### Tests
- Added `npm test` using Node’s built-in `node:test` (no new dependencies).
- In-memory mock DB only — does not touch `prisma/dev.sqlite`.

---

## 2. Files changed / added

| Path | Change |
| --- | --- |
| `app/routes/app.test-email.jsx` | Admin auth |
| `app/routes/proxy.jsx` | Uses subscription service |
| `app/routes/webhooks.inventory.update.jsx` | Uses `applyVariantStockUpdate` |
| `app/services/notifications.server.js` | Enqueue/deliver/retry hardening |
| `app/services/inventory-restock.server.js` | **Added** restock durability orchestration |
| `app/services/subscriptions.server.js` | **Added** subscribe helpers |
| `tests/**` | **Added** automated tests + mock DB |
| `package.json` | Added `"test"` script only |
| `docs/PHASE_2_IMPLEMENTATION.md` | This file |
| `docs/PHASE_2_TEST_RESULTS.md` | Test/command results |
| `docs/FEATURE_CHECKLIST.md` | Updated where verified by tests |

**Unchanged intentionally:** theme widget UI/CSS, Polaris pages styling, Prisma schema/migrations, Shopify toml, Resend integration internals (aside from call sites).

---

## 3. Design decisions and tradeoffs

| Decision | Why | Tradeoff |
| --- | --- | --- |
| Queue before flipping `isInStock` | Fixes “crash after state update, skip forever” with no migration | Brief window where jobs exist while state still shows OOS (safe; next webhook is idempotent) |
| No new queue infrastructure | Approved scope; existing Prisma table is enough | Sends still happen in-process during webhook / manual retry |
| No scheduler yet | Approved scope | Merchants must click “Run notification retries” (or call the admin route) |
| Terminal failure for cancelled subs | Avoids wasting attempts / accidental email | Operator must create a new subscription if the customer re-opts in |
| `node:test` + mocks | No new npm packages | Route-level Shopify auth for `test-email` not integration-tested |

---

## 4. Delivery guarantees (honest)

**Not exactly-once.**

- Jobs are **at-least-once**.
- Unique restock keys reduce duplicate **jobs**.
- If Resend accepts an email and the DB fails to mark `SENT`, a retry may send a **second** email.
- No provider message-id idempotency is stored yet.

---

## 5. Remaining risks

1. Manual retries only — no cron/worker (recommended next step after Phase 2).
2. Residual duplicate-email risk (provider vs DB).
3. App uninstall still deletes sessions only (customer emails remain) — out of Phase 2 scope but still important.
4. App proxy has no rate limiting.
5. Multi-location inventory still uses aggregated variant quantity.
6. No unique DB constraint on ACTIVE `(shop, email, variantId)` — race can still create duplicates under concurrent proxy posts.
7. `app.test-email` auth is enforced in code; full HTTP integration test against Shopify session was not added.

---

## 6. Recommended next step (automatic retries)

After Phase 2, add a **secured scheduled job** (host cron or similar) that POSTs to the existing admin retry logic or calls `retryFailedNotifications()` on an interval. Do not buy Redis/BullMQ until volume requires it.

---

## 7. Database migrations

**None.** Schema unchanged.
