# Phase 4 — Test results

**Date:** 2026-10-21

## Commands

| Command | Result |
| --- | --- |
| `npm test` | **Passed.** 39 tests, 0 failures. |
| `npm run lint` | **Passed** after moving the environment read into the server module. The first lint run failed with `'process' is not defined` in the route file. |
| `npm run typecheck` | **Passed** |
| `npm run build` | **Passed** |

The new tests cover:

- A `PENDING` job older than 2 minutes is sent, and a fresh `PENDING` job is left untouched.
- A `SENT` job is not sent again.
- Backoff still skips a recent `FAILED` job.
- A stale `SENDING` job is recovered once.
- Two overlapping workers send once.
- An out-of-stock skip does not increase the attempt count, and a later in-stock retry still sends.
- A missing secret, a missing token, and a wrong token return 401 and do not run the worker.
- A non-POST request returns 405.
- An authorized response contains only aggregate counts.
- The admin retry path runs only after authentication succeeds, and does not run when authentication throws.

Tests use an in-memory database and fake email and Shopify clients. They do not send real email or modify `prisma/dev.sqlite`.

## Not active

No scheduler was created. Opening the app does not retry notifications automatically. Use the manual button in local development.
