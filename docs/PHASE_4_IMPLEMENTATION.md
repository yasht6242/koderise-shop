# Phase 4 — Implementation

**Date:** 2026-10-21  
**Scope:** Prepare a secret-protected retry route and make retry recovery safe for a future scheduler.

Automatic retries are **not active**. Nothing in the app calls this route on a timer. Local development still uses the manual **Run notification retries** button.

No dependencies, Prisma migrations, hosting, scheduler accounts, `.env` edits, Shopify config, CSS, or Liquid changes.

## Behavior

- `POST /internal/notification-retries` runs the existing retry worker only when the `Authorization: Bearer` token matches `NOTIFICATION_RETRY_SECRET`.
- The comparison hashes both values and uses `timingSafeEqual`. An empty or missing secret always fails, even if the caller sends an empty token.
- Missing or wrong credentials return HTTP 401. Non-POST requests return HTTP 405. The JSON body contains only `success` and the counts `retried`, `sent`, `failed`, and `skipped`.
- `/app/retry-notifications` still requires Shopify admin authentication, then runs the same worker. The home-page button is unchanged.
- `PENDING` jobs are recovered only after they are 2 minutes old, so a webhook that is still sending is not raced for a job it just created. The claim still prevents two workers from sending the same job.
- If a retry finds the product out of stock, the attempt count is restored to the value from before that claim. The five-attempt limit is kept for real send failures. A later in-stock retry can still email.
- Backoff, cancelled subscriptions, missing variants, and `SENT` jobs behave as before.

## Environment variable

Name: `NOTIFICATION_RETRY_SECRET`

Set it only in the environment or in the gitignored `.env` file. Do not commit the value and do not paste it into chat or docs. Use a long random string with no quotes and no trailing space. Restart `shopify app dev` after changing `.env`.

Until a host scheduler is configured, the app will not call the new route by itself. The manual button does not need this variable.

## Files

| File | Change |
| --- | --- |
| `app/routes/internal.notification-retries.jsx` | New POST-only route |
| `app/services/notification-retry-http.server.js` | Bearer check and count-only responses |
| `app/services/notifications.server.js` | Stale `PENDING` recovery and out-of-stock attempt restore |
| `app/routes/app.retry-notifications.jsx` | Still admin-authenticated; response limited to counts |
| `tests/notifications-retry.test.js` | Stale, fresh, `SENT`, and out-of-stock cases |
| `tests/notification-retry-http.test.js` | Secret and admin-auth cases |
| `package.json` | Test script includes the new file |
| `docs/FEATURE_CHECKLIST.md` | Status notes |
| `docs/PHASE_4_IMPLEMENTATION.md` | This file |
| `docs/PHASE_4_TEST_RESULTS.md` | Command results |

## Remaining risks

- If Resend accepts an email and the process dies before the row is marked `SENT`, a later retry can send a second email.
- Out-of-stock jobs stay retryable, so a future scheduler will keep checking Shopify until the product is available or the subscription is cancelled.
- One SQLite file is still not safe for more than one app process. A separate worker process needs PostgreSQL first.
- The route does nothing useful until `NOTIFICATION_RETRY_SECRET` is set and some approved scheduler calls it.
