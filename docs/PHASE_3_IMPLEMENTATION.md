# Phase 3 — Implementation

**Date:** 2026-10-21  
**Scope:** Merchant dashboard, subscriptions navigation, storefront Back-in-Stock visibility and variant sync, removal of the unused star-rating snippet and locale.

No Prisma, `.env`, `shopify.app.toml`, dependency, or deployment changes.

## What changed

### Merchant admin
- `app/routes/app._index.jsx` no longer creates demo products or shows the template tutorial. The home page loads four live counts for the current shop: active subscriptions, `PENDING`, `FAILED`, and `SENT` notifications. The existing “Run notification retries” control still posts to `/app/retry-notifications`.
- `app/routes/app.jsx` adds a Subscriptions link beside Home and Additional page.
- `app/routes/app.subscriptions.jsx` removes the sentence that said email notifications were not enabled.

### Storefront widget
- `extensions/back-in-stock-widget/blocks/star_rating.liquid` keeps the same classes, spacing, colors, and merchant heading, description, and button text. The block filename was not renamed.
- The form is shown only when the selected variant has `available == false` (sold out, inventory not set to continue selling). If the variant is available, unknown, or cannot be determined, the widget stays hidden.
- Hiding uses an inline `display: none` on the widget. That was required because the existing form rule sets `display: grid`, which would override the HTML `hidden` attribute. The stylesheet block itself was not changed.
- `extensions/back-in-stock-widget/assets/back-in-stock.js` updates the variant when the shopper changes a product-form field named `id`, when the `variant` URL parameter changes (including `pushState` / `replaceState`), or when the theme replaces the section markup. If several forms disagree, the widget hides instead of guessing.
- Submit still posts to `/apps/back-in-stock`. App Proxy validation and email delivery were not changed.

### Removed
- `extensions/back-in-stock-widget/snippets/stars.liquid`
- `extensions/back-in-stock-widget/locales/en.default.json`

`assets/thumbs-up.png` is still in the extension and is not referenced. It was not part of the approved deletion list.

## Files

| File | Change |
| --- | --- |
| `app/routes/app._index.jsx` | Dashboard counts; demo removed; retry kept |
| `app/routes/app.jsx` | Subscriptions nav link |
| `app/routes/app.subscriptions.jsx` | Stale sentence removed |
| `app/services/storefront-widget-state.js` | Testable show/hide and variant-choice rules |
| `extensions/back-in-stock-widget/blocks/star_rating.liquid` | Eligibility data; same appearance |
| `extensions/back-in-stock-widget/assets/back-in-stock.js` | Variant sync and fail-safe hide |
| `tests/storefront-widget-state.test.js` | New unit tests |
| `package.json` | Test script includes the new file |
| `docs/FEATURE_CHECKLIST.md` | Status notes for this phase |
| `docs/PHASE_3_IMPLEMENTATION.md` | This file |
| `docs/PHASE_3_TEST_RESULTS.md` | Command results |

## Limitations

- The development store theme is not in this repository. Themes that do not use `name="id"` and do not put the variant id in the URL will keep the widget hidden. That is intentional.
- The widget decision rules are unit-tested. The Liquid markup and the browser event wiring were not executed in a storefront browser.
- The admin home page was not opened in Shopify Admin during this implementation.
- Notification retry is still manual.
