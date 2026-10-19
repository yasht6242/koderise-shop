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
| Storefront widgets | **PARTIAL** | Theme block + JS for BIS only; leftover star-rating assets; no App Embed multi-module system |
| Customer subscription flow | **PARTIAL** | App proxy create + validation; no unsubscribe link in email; no SMS/push |
| Merchant dashboard | **PARTIAL** | Subscriptions list/create/cancel; home still template demo; no module toggles |
| Settings | **NOT STARTED** | No settings models/UI (email templates, thresholds, module enablement) |
| Notifications (multi-channel) | **PARTIAL** | Email via Resend only; no SMS/push/WhatsApp |
| Reporting / analytics | **NOT STARTED** | No demand reports, send metrics UI, or exports |
| Stack / architecture recommendations | **PARTIAL** | Current stack already chosen (React Router + Prisma + SQLite local); documented in `ARCHITECTURE_AND_COSTS.md` |

---

## B. Back-in-stock subscription flow

| Item | Status | Paths / evidence |
| --- | --- | --- |
| Storefront email capture | **PARTIAL** | `extensions/back-in-stock-widget/blocks/star_rating.liquid`, `assets/back-in-stock.js` — always shown; no sold-out gate; variant change not tracked |
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
| Correct block naming / cleanup | **PARTIAL** | Block file still `star_rating.liquid`; `snippets/stars.liquid` + ratings locales leftover |
| Show only when OOS | **NOT STARTED** | No availability condition in Liquid |
| Variant selector sync | **NOT STARTED** | `data-variant-id` set once at render |
| Accessibility | **PARTIAL** | `aria-live` on message; basic form labels |
| i18n | **PARTIAL** | Merchant settings strings; leftover ratings locale JSON |

---

## D. Email notifications

| Item | Status | Paths / evidence |
| --- | --- | --- |
| Resend integration | **PARTIAL** | `app/services/email.server.js` |
| HTML escaping | **PARTIAL** | Title/URL escaped in HTML; subject uses raw title |
| Branded / merchant-editable templates | **NOT STARTED** | Hardcoded HTML |
| SMS / Push / WhatsApp | **NOT STARTED** / **BLOCKED** | Not in code; cost/provider choice needs approval |
| Test email utility | **PARTIAL** | `app/routes/app.test-email.jsx` — **unauthenticated** (security issue) |

---

## E. Notification queue and retries

| Item | Status | Paths / evidence |
| --- | --- | --- |
| Durable notification records | **PARTIAL** | `BackInStockNotification` model + migration |
| Statuses PENDING / SENDING / SENT / FAILED | **PARTIAL** | Set in `notifications.server.js` |
| Dedup per restock cycle | **PARTIAL** | `@@unique([subscriptionId, restockKey])` |
| Atomic claim before send | **PARTIAL** | `updateMany` status claim |
| Manual retry route (admin) | **PARTIAL** | `app/routes/app.retry-notifications.jsx` + home UI |
| Automated / scheduled retry worker | **NOT STARTED** | No cron, queue worker process, or Shopify Flow schedule |
| Retry limits + exponential backoff | **PARTIAL** | Max 5 attempts; backoff in `retryFailedNotifications` |
| Stale SENDING recovery | **PARTIAL** | 10-minute threshold in retry helper only |
| Dead-letter handling | **PARTIAL** | Exhausted attempts remain FAILED; no DLQ UI/alert |
| Provider idempotency / duplicate-email prevention | **NOT STARTED** | At-least-once delivery risk documented in audit |

---

## F. Inventory webhook & stock transitions

| Item | Status | Paths / evidence |
| --- | --- | --- |
| `inventory_levels/update` subscription | **PARTIAL** | Declared in `shopify.app.toml`; remote registration not verified |
| HMAC verification | **PARTIAL** | `authenticate.webhook` in `webhooks.inventory.update.jsx` |
| Duplicate webhook ID protection | **PARTIAL** | `ProcessedWebhook`; delete-on-failure for retries |
| OOS → IS transition detection | **PARTIAL** | `InventoryVariantState` comparison |
| Reset eligibility when OOS again | **PARTIAL** | Clears `notifiedAt` on OOS |
| Safe ordering (state vs queue durability) | **PARTIAL** | State updated before queue — crash can skip emails |
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
| Module enable/disable settings | **NOT STARTED** | — |
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
| Prisma schema + migrations present | **PARTIAL** | Six migrations; SQLite local |
| Production-ready DB | **NOT STARTED** | Still SQLite hardcoded URL |
| BIS-related tables | **PARTIAL** | Subscriptions, webhooks, inventory state, notification queue |
| Preorder/wishlist/settings tables | **NOT STARTED** | — |

---

## O. Background processing

| Item | Status | Paths / evidence |
| --- | --- | --- |
| In-process queue table | **PARTIAL** | `BackInStockNotification` |
| Webhook-inline send | **PARTIAL** | Sends during webhook request (scalability risk) |
| Separate worker / Redis / BullMQ | **NOT STARTED** | — |
| Scheduled retries | **NOT STARTED** | Manual only |

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
| Unit / integration / e2e tests | **NOT STARTED** | No test files; no `test` script |
| Lint / typecheck scripts | **PARTIAL** | Scripts exist; not run in Phase 1 |
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
| DONE | **0** (nothing re-verified by automated/manual test in this audit) |
| PARTIAL | Majority of existing BIS / auth / webhook work |
| NOT STARTED | Preorder, wishlist, low-stock, settings, reporting, tests, scheduled workers, monitoring |
| BLOCKED | Reference-app parity, multi-channel notifications, paid hosting/SMS, some legal/product decisions |

---

## Suggested DONE criteria for next phases

Mark an item **DONE** only when:

1. Code implements the behavior, and  
2. An automated test or a documented manual test run in-repo confirms it, and  
3. For reference-parity items: behavior was compared against the installed reference app or an approved written spec.
