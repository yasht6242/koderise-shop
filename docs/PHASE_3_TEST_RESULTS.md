# Phase 3 — Test results

**Date:** 2026-10-21

## Commands

| Command | Result |
| --- | --- |
| `npm test` | **Passed.** 30 tests, 0 failures. Includes the previous 20 Phase 2 tests and 10 new widget-state tests. |
| `npm run lint` | **Passed** (exit 0) |
| `npm run typecheck` | **Passed** (exit 0) |
| `npm run build` | **Passed** (exit 0) |

Build still prints the existing Vite note that `shopify.server.js` is both dynamically and statically imported. It does not fail the build.

## What the new tests cover

`tests/storefront-widget-state.test.js` checks the decision rules used by the storefront script:

- Show only when the selected variant is `available: false`.
- Hide available variants, unknown ids, and a missing selection.
- Prefer one matching product-form variant.
- Refuse to guess when forms disagree.
- Fall back to the URL `variant` parameter, then to a single-variant product.

They do not open a browser, call Shopify, or send email.

## Not verified here

- The embedded admin home page and Subscriptions nav inside Shopify Admin.
- The theme block on a product page, including a real variant picker.
- App Proxy submission after the widget change.
- Whether `assets/thumbs-up.png` is used by an already-published theme copy. It is not referenced in this repository.

## Manual checks in the development store

1. Run `shopify app dev` and open the app. Confirm Home shows live counts and **Run notification retries** still works.
2. Open **Subscriptions** from the nav and confirm the old “emails are not enabled” sentence is gone.
3. In the theme editor, confirm the Back in stock block is still the same block (it is still the `star_rating` file so existing placements stay attached).
4. On a product, select an in-stock variant and confirm the widget is hidden.
5. Select a sold-out variant that does not continue selling and confirm the widget appears and the email still subscribes.
6. If the widget stays hidden for a sold-out variant, the theme is not exposing `name="id"` or a `variant` URL parameter. Do not force it to show.
