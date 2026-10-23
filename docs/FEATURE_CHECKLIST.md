# KodRise Tech — Feature Checklist (Phase 1)

**Audit date:** 2026-10-19  
**Status legend**

| Status | Meaning |
| --- | --- |
| **DONE** | Verified in code and, where applicable, by a successful test run in this audit |
| **PARTIAL** | Meaningful implementation exists; important behavior missing or unverified |
| **NOT STARTED** | No meaningful implementation found |
| **BLOCKED** | Needs missing access, credentials, clarification, or external testing |

**Notes**

- The project PDF is a **stack questionnaire** plus a directive to match the reference app’s core flows; it is not a line-item UX spec.
- User-reported local BIS testing is noted as **claimed**, not re-executed here. Therefore BIS items are **PARTIAL**, not DONE.
- Reference app was not installed/tested in this audit → parity items are **BLOCKED** where they depend on that review.

---

## A. Requirements from project PDF / reference scope

| Requirement | Status | Evidence / notes |
| --- | --- | --- |
| Install & review reference app on a dev store | **BLOCKED** | Not performed in this audit; needed for “100% as-is” decisions |
| Match reference core functionality & user flow | **BLOCKED** | Cannot claim parity without install/test + product decisions |
| Back-in-stock alerts | **PARTIAL** | Code path exists; local success claimed; no automated tests |
| Pre-order | **NOT STARTED** | No models, routes, theme blocks, or checkout integration |
| Wishlist | **NOT STARTED** | No models/routes/theme UI |
| Low-stock | **NOT STARTED** | No threshold settings, badges, or merchant alerts |
| Storefront widgets | **PARTIAL** | BIS block hides unless the selected variant is unavailable. Rules covered by `tests/storefront-widget-state.test.js`. The full suite is 51 tests, all passed. Not verified in a live theme. The widget asks the app proxy whether Back in Stock is enabled before it submits. |
| Customer subscription flow | **PARTIAL** | App proxy create + validation; no unsubscribe link in email; no SMS/push |
| Merchant dashboard | **PARTIAL** | Home shows live subscription and notification counts and keeps manual retry. Subscriptions is in the nav. Settings can turn Back in Stock off for the current shop. Not re-checked inside Shopify Admin in this phase. |
| Settings | **PARTIAL** | `/app/settings` saves a per-shop Back in Stock switch in `ShopSetting`. A missing row stays enabled. The page still explains theme-block text, unavailable-variant display, one notification per restock cycle, manual retries, and that the sender is `RESEND_FROM_EMAIL` without showing its value. Live Admin save was not re-checked. |
| Notifications (multi-channel) | **PARTIAL** | Email via Resend only; no SMS/push/WhatsApp |
| Reporting / analytics | **NOT STARTED** | No demand reports, send metrics UI, or exports |
| Stack / architecture recommendations | **PARTIAL** | Current stack already chosen (React Router + Prisma + SQLite local); documented in `ARCHITECTURE_AND_COSTS.md` |

---

## B. Back-in-stock subscription flow

| Item | Status | Paths / evidence |
| --- | --- | --- |
| Storefront email capture | **PARTIAL** | Widget submits only after an unavailable variant is resolved, and only after the app proxy reports `enabled: true`. The server also rejects creation when the module is off or the setting cannot be read. Live theme submit not re-tested in this phase. |
| App proxy authentication | **PARTIAL** | `app/routes/proxy.jsx` uses `authenticate.public.appProxy` — verified in code; runtime not re-tested |
| Input validation (email + GIDs) | **PARTIAL** | Regex + GraphQL product↔variant check in `proxy.jsx` |
| Persist subscription | **PARTIAL** | `BackInStockSubscription` create; no unique constraint; race possible |
| Duplicate ACTIVE subscription handling | **PARTIAL** | Application-level check returns 409; not DB-enforced |
| Customer unsubscribe | **NOT STARTED** | Merchant cancel only; no customer-facing cancel/token link |
| Abuse protection (rate limit) | **NOT STARTED** | — |

---

## C. Storefront widget (theme extension)

| Item | Status | Paths / evidence |
| --- | --- | --- |
| Theme app extension present | **PARTIAL** | `extensions/back-in-stock-widget/` |
| Merchant block settings | **PARTIAL** | heading / description / button_text in Liquid schema |
| Correct block naming / cleanup | **PARTIAL** | Unused `snippets/stars.liquid` and ratings locale removed. Block file remains `star_rating.liquid` so existing theme placements keep working. `assets/thumbs-up.png` is still present and unused. |
| Show only when OOS | **PARTIAL** | `variant.available == false` required. Unit-tested. Hidden with inline `display:none` so the existing `display:grid` form rule does not keep it visible. Not checked in a browser. |
| Variant selector sync | **PARTIAL** | Reads `name="id"` in the same section or product root, then the `variant` URL parameter, then a single-variant product. Ambiguous or unknown selections stay hidden. Unit-tested. Live theme not checked. |
| Accessibility | **PARTIAL** | `aria-live` on message; basic form labels |
| i18n | **PARTIAL** | Merchant heading, description, and button text remain in the block settings. Ratings locale file removed. |

---

## D. Email notifications

| Item | Status | Paths / evidence |
| --- | --- | --- |
| Resend integration | **PARTIAL** | `app/services/email.server.js` |
| HTML escaping | **PARTIAL** | Title/URL escaped in HTML; subject uses raw title |
| Branded / merchant-editable templates | **NOT STARTED** | Hardcoded HTML |
| SMS / Push / WhatsApp | **NOT STARTED** / **BLOCKED** | Not in code; cost/provider choice needs approval |
| Test email utility | **PARTIAL** | `app/routes/app.test-email.jsx` — now uses `authenticate.admin` (Phase 2); HTTP session integration not automated |

---

## E. Notification queue and retries

| Item | Status | Paths / evidence |
| --- | --- | --- |
| Durable notification records | **PARTIAL** | Model + Phase 2 enqueue-before-state-update; covered by `tests/inventory-restock.test.js` |
| Statuses PENDING / SENDING / SENT / FAILED | **PARTIAL** | Set in `notifications.server.js`; unit-tested |
| Dedup per restock cycle | **PARTIAL** | Unique key + tests for duplicate restockKey |
| Atomic claim before send | **PARTIAL** | `updateMany` claim; concurrent send/retry tests pass |
| Manual retry route (admin) | **PARTIAL** | `app/routes/app.retry-notifications.jsx` + home UI |
| Automated / scheduled retry worker | **PARTIAL** | `POST /internal/notification-retries` is secret-protected and tested. No host scheduler is configured, so local retries stay on the manual button. |
| Retry limits + exponential backoff | **PARTIAL** | Max 5; backoff tested |
| Stale SENDING recovery | **PARTIAL** | 10-minute threshold; tested in `notifications-retry.test.js` |
| Dead-letter handling | **PARTIAL** | Exhausted attempts remain FAILED; cancelled subs forced to max attempts |
| Provider idempotency / duplicate-email prevention | **NOT STARTED** | At-least-once residual risk remains (documented in Phase 2) |

---

## F. Inventory webhook & stock transitions

| Item | Status | Paths / evidence |
| --- | --- | --- |
| `inventory_levels/update` subscription | **PARTIAL** | Declared in `shopify.app.toml`; remote registration not verified |
| HMAC verification | **PARTIAL** | `authenticate.webhook` in `webhooks.inventory.update.jsx` |
| Duplicate webhook ID protection | **PARTIAL** | `ProcessedWebhook`; delete-on-failure for retries |
| OOS → IS transition detection | **PARTIAL** | `InventoryVariantState` comparison |
| Reset eligibility when OOS again | **PARTIAL** | Clears `notifiedAt` on OOS |
| Safe ordering (state vs queue durability) | **PARTIAL** | Phase 2: jobs enqueued before `isInStock` flip (`inventory-restock.server.js`); unit-tested. Not fully crash-proof at OS level. |
| Multi-location correctness | **PARTIAL** / **BLOCKED** | Uses aggregated variant quantity; not location-aware; needs product decision |
| GraphQL throttling / transient retries | **NOT STARTED** | Failures bubble to 500 / FAILED |

---

## G. Pre-orders

| Item | Status | Paths / evidence |
| --- | --- | --- |
| Preorder offers / product flags | **NOT STARTED** | — |
| Storefront preorder button replacing Sold Out | **NOT STARTED** | — |
| Partial / full / no payment upfront | **NOT STARTED** / **BLOCKED** | Needs Shopify checkout/payment design + approval |
| Preorder confirmation notifications | **NOT STARTED** | — |
| Merchant preorder management | **NOT STARTED** | — |

---

## H. Wishlist

| Item | Status | Paths / evidence |
| --- | --- | --- |
| Guest + customer wishlist | **NOT STARTED** | — |
| Storefront save UI | **NOT STARTED** | — |
| Merchant demand view | **NOT STARTED** | — |

---

## I. Low-stock alerts

| Item | Status | Paths / evidence |
| --- | --- | --- |
| Threshold settings | **NOT STARTED** | — |
| Storefront “Only X left” badge | **NOT STARTED** | — |
| Merchant low-stock email | **NOT STARTED** | — |

---

## J. Merchant dashboard & settings

| Item | Status | Paths / evidence |
| --- | --- | --- |
| Embedded app shell | **PARTIAL** | `app/routes/app.jsx` App Bridge + Polaris web components |
| Subscription management UI | **PARTIAL** | `app/routes/app.subscriptions.jsx` — not in nav; stale “emails not enabled” copy |
| Inventory debug view | **PARTIAL** | `app/routes/app.additional.jsx` |
| Module enable/disable settings | **PARTIAL** | Per-shop `ShopSetting.backInStockEnabled`. Disabled shops reject new storefront and merchant subscriptions, keep existing subscriptions cancellable, and hold unsent jobs. Re-enable uses the existing retry rules and does not bulk-send. Covered by `tests/shop-settings.test.js`. Not verified in a live Shopify Admin session. |
| Widget/email customization settings | **NOT STARTED** | Beyond theme block settings |
| Clean merchant home (non-template) | **NOT STARTED** | `app._index.jsx` still template product generator |

---

## K. Reporting and analytics

| Item | Status | Paths / evidence |
| --- | --- | --- |
| Demand by product/variant | **NOT STARTED** | Data could be derived from subscriptions later |
| Notification delivery stats | **NOT STARTED** | Queue table exists but no UI/aggregations |
| Export / marketing sync (Klaviyo etc.) | **NOT STARTED** / **BLOCKED** | External integrations need approval |

---

## L. Shopify authentication and sessions

| Item | Status | Paths / evidence |
| --- | --- | --- |
| OAuth install / auth routes | **PARTIAL** | `app/shopify.server.js`, `app/routes/auth.*` — template pattern; not re-tested |
| Prisma session storage | **PARTIAL** | `Session` model + `@shopify/shopify-app-session-storage-prisma` |
| Expiring offline tokens | **PARTIAL** | `future.expiringOfflineAccessTokens: true` |
| Scopes least privilege | **PARTIAL** | Template scopes still present in `shopify.app.toml` |
| Scopes update webhook | **PARTIAL** | `webhooks.app.scopes_update.jsx` |

---

## M. Admin API and webhooks

| Item | Status | Paths / evidence |
| --- | --- | --- |
| Admin GraphQL usage | **PARTIAL** | Variant validation, inventory lookups, template product create |
| REST Admin API | **NOT STARTED** | Not used (and not required for current BIS path) |
| Storefront API | **NOT STARTED** | Not used |
| App uninstalled webhook | **PARTIAL** | Deletes sessions only — incomplete data cleanup |
| Shopify Functions | **NOT STARTED** | Not present; may be needed later for preorder checkout rules (**BLOCKED** pending design) |

---

## N. Database and migrations

| Item | Status | Paths / evidence |
| --- | --- | --- |
| Prisma schema + migrations present | **PARTIAL** | Seven migrations; SQLite local. `20261021153000_add_shop_setting` was applied with `prisma migrate deploy`. `prisma generate` updated the client source, then failed to replace the locked query-engine DLL (`EPERM`). |
| Production-ready DB | **NOT STARTED** | Still SQLite hardcoded URL |
| BIS-related tables | **PARTIAL** | Subscriptions, webhooks, inventory state, notification queue, per-shop `ShopSetting` |
| Preorder/wishlist/settings tables | **PARTIAL** | `ShopSetting` only. No preorder or wishlist tables. |

---

## O. Background processing

| Item | Status | Paths / evidence |
| --- | --- | --- |
| In-process queue table | **PARTIAL** | `BackInStockNotification` |
| Webhook-inline send | **PARTIAL** | Sends during webhook request (scalability risk) |
| Separate worker / Redis / BullMQ | **NOT STARTED** | — |
| Scheduled retries | **PARTIAL** | Route and recovery rules are in place. Automatic execution is not active until a future host scheduler is approved and configured. |

---

## P. Error handling and logging

| Item | Status | Paths / evidence |
| --- | --- | --- |
| `console.log` / `console.error` | **PARTIAL** | Present on webhook/proxy/email paths |
| Structured logging / correlation IDs | **NOT STARTED** | — |
| Error tracking (Sentry etc.) | **NOT STARTED** | — |
| Merchant-visible failure UI | **PARTIAL** | Retry JSON dump on home; no ops dashboard |

---

## Q. Testing

| Item | Status | Paths / evidence |
| --- | --- | --- |
| Unit / integration / e2e tests | **PARTIAL** | `npm test` passed with 51 `node:test` cases (mocked), including Phase 6 shop-setting cases. No browser E2E / live Shopify tests |
| Lint / typecheck scripts | **PARTIAL** | Phase 6 re-run: lint, typecheck, and build passed |
| CI pipeline | **NOT STARTED** | No GitHub Actions / similar found |

---

## R. Production hosting, deployment, monitoring, security

| Item | Status | Paths / evidence |
| --- | --- | --- |
| Dockerfile | **PARTIAL** | `Dockerfile` present; not validated here |
| Hosting chosen & deployed | **NOT STARTED** / **BLOCKED** | Needs approval before creating paid resources |
| Secret management / `.env.example` | **NOT STARTED** | No example env file; `.gitignore` would ignore `.env.*` |
| Monitoring / uptime | **NOT STARTED** | — |
| GDPR / uninstall data deletion | **PARTIAL** | Session delete only |
| Compliance for email marketing (consent, CAN-SPAM/CASL) | **NOT STARTED** / **BLOCKED** | Product/legal clarification needed |

---

## Summary counts (approximate)

| Status | Count (rows above) |
| --- | --- |
| DONE | **0** for full production BIS (live store E2E still required); several unit cases now pass in Phase 2 |
| PARTIAL | BIS pipeline, retries, auth, webhooks, new automated unit tests |
| NOT STARTED | Preorder, wishlist, low-stock, reporting, scheduled workers, monitoring |
| BLOCKED | Reference-app parity, multi-channel notifications, paid hosting/SMS, some legal/product decisions |

---

## Suggested DONE criteria for next phases

Mark an item **DONE** only when:

1. Code implements the behavior, and  
2. An automated test or a documented manual test run in-repo confirms it, and  
3. For reference-parity items: behavior was compared against the installed reference app or an approved written spec.
