# Phase 2 — Test Results

**Date:** 2026-10-19  
**Environment:** Local Windows, Node v22.18.0, repository `koderise-shopi-dev`

---

## 1. Automated tests

**Command:** `npm test`  
**Runner:** Node built-in `node:test` (no new dependencies)  
**Result:** **PASSED** — 20 tests, 0 failures

```
# tests 20
# suites 6
# pass 20
# fail 0
```

### Coverage mapped to Phase 2 requirements

| Requirement | Covered by | Result |
| --- | --- | --- |
| Valid subscription creation | `tests/subscriptions.test.js` | Pass |
| Invalid email / malformed GIDs | `tests/subscriptions.test.js` | Pass |
| Duplicate active subscriptions | `tests/subscriptions.test.js` | Pass |
| Duplicate Shopify webhook delivery | `tests/inventory-restock.test.js` (`recordProcessedWebhook`) | Pass |
| OOS → in-stock transition + durable jobs before state flip | `tests/inventory-restock.test.js` | Pass |
| No notification on initial stock observation | `tests/inventory-restock.test.js` | Pass |
| Failure during notification processing keeps FAILED job | `tests/inventory-restock.test.js` | Pass |
| Retry FAILED job | `tests/notifications-retry.test.js` | Pass |
| Recover stale SENDING | `tests/notifications-retry.test.js` | Pass |
| Concurrent workers cannot double-send | `tests/notifications-retry.test.js` | Pass |
| Cancelled subscription not emailed | `tests/notifications-retry.test.js` | Pass |
| Still OOS not emailed | `tests/notifications-retry.test.js` | Pass |
| Backoff respected | `tests/notifications-retry.test.js` | Pass |

### Untested / limited (documented, not claimed as passed)

| Case | Why untested |
| --- | --- |
| Full HTTP auth for `/app/test-email` against a real Shopify session | Would need Shopify session/test harness; code review confirms `authenticate.admin` on loader/action |
| Live Resend delivery | Intentionally mocked; no real emails |
| Live Shopify Admin GraphQL / webhooks | Mocked |
| Theme widget browser E2E | Out of scope; UI not redesigned |
| Crash injection at process level | Simulated via ordering assertions + failed send; not a real process kill |
| Multi-location inventory edge cases | Not in Phase 2 scope |

Tests use an **in-memory mock DB** only. They do **not** modify `prisma/dev.sqlite`.

---

## 2. Project quality commands

| Command | Result |
| --- | --- |
| `npm test` | **Passed** (20/20) |
| `npm run lint` | **Passed** (exit 0) |
| `npm run typecheck` | **Passed** (exit 0) |
| `npm run build` | **Passed** (exit 0) |

### Build notes (non-failing)
- Empty client chunks for server-only routes (unchanged template behavior).
- Vite warning: `shopify.server.js` is dynamically imported from `notifications.server.js` (for test isolation of the default admin getter) and also statically imported elsewhere. Build still succeeds.

---

## 3. Safety checks

| Check | Status |
| --- | --- |
| No secrets added to source | Confirmed (no `.env` contents committed; no API keys in new files) |
| No paid services / deployment / cloud resources | Confirmed |
| No Prisma migrations | Confirmed |
| No UI/CSS redesign of widget or merchant pages | Confirmed |
| No new npm dependencies | Confirmed (`package.json` only gained a `test` script) |

---

## 4. Manual checks still recommended in the Shopify development store

These were **not** re-run automatically in Phase 2:

1. Enable the Back in Stock theme block on a product template.
2. Subscribe with a test email on an out-of-stock variant.
3. Restock the variant in Admin; confirm email arrives (Resend).
4. Confirm `/app` → “Run notification retries” still works when logged into the embedded app.
5. Confirm `/app/test-email` **rejects** unauthenticated access and works when opened inside the authenticated admin app (if you still use it).
