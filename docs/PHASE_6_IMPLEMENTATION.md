# Phase 6 — Back in Stock module toggle

**Date:** 2026-10-21

Each shop can turn Back in Stock on or off from `/app/settings`. The value is stored on `ShopSetting`, keyed by the authenticated shop. Storefront and webhook code read the shop from the verified Shopify session or webhook, not from the request body.

A shop with no `ShopSetting` row stays enabled. That preserves shops that already use Back in Stock.

## While the module is off

- The storefront proxy and the merchant Subscriptions form both reject new subscriptions. Existing subscriptions stay visible, and merchants can still cancel them.
- An inventory webhook is still verified, recorded, and treated as idempotent. Stock transitions are still saved, and restock jobs are still queued. Those jobs are not delivered.
- Pending, failed, and stale-sending notification rows are left as they are. The retry worker checks the shop setting before it claims a job. A disabled shop's status, attempts, and error text stay unchanged. Idempotency records are not deleted or rewritten.
- Turning the module back on does not send held jobs immediately. The existing retry rules decide when a job is eligible, including the two-minute wait for a pending job and the current backoff for a failed job. Home's Run notification retries button, or a future scheduler using the same function, is what processes them.

If the setting cannot be read, new subscriptions are rejected and notification claims are skipped. A restock is not recorded in that case, so the webhook returns 500 and the processed-webhook row is removed. Shopify can deliver that webhook again.

## Limitation

A notification that has already been claimed can still finish sending after the merchant turns the module off. The setting is checked before a new claim, not during an email that is already in progress.

The storefront widget still uses the same heading, description, button text, and CSS. Before it posts a subscription, it reads the app proxy and submits only when `enabled` is exactly `true`.

## Files

- `prisma/schema.prisma`
- `prisma/migrations/20261021153000_add_shop_setting/migration.sql`
- `app/services/shop-settings.server.js`
- `app/services/subscriptions.server.js`
- `app/services/inventory-restock.server.js`
- `app/services/notifications.server.js`
- `app/routes/app.settings.jsx`
- `app/routes/app.subscriptions.jsx`
- `app/routes/proxy.jsx`
- `extensions/back-in-stock-widget/assets/back-in-stock.js`
- `tests/helpers/mock-db.js`
- `tests/shop-settings.test.js`
- `docs/FEATURE_CHECKLIST.md`

## Commands

| Command | Result |
| --- | --- |
| `npx prisma migrate deploy` | Passed. Applied `20261021153000_add_shop_setting` to local `file:dev.sqlite`. Existing migrations were not edited or reset. |
| `npx prisma generate` | Failed. The client source includes `ShopSetting`, then Windows returned `EPERM` while replacing `query_engine-windows.dll.node`. The engine file is locked by another process. This was not retried by stopping that process. |
| `npm test` | Passed. 51 tests, 0 failures. |
| `npm run lint` | Passed. |
| `npm run typecheck` | Passed. |
| `npm run build` | Passed. |

The migration was applied to the local SQLite file only. Live Shopify Admin, the theme widget, and a real inventory webhook were not exercised in this phase.
