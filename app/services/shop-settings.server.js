/**
 * A missing row means Back in Stock stays enabled.
 * A read error is thrown so callers can fail closed.
 */
export async function isBackInStockEnabled(db, shop) {
  const setting = await db.shopSetting.findUnique({
    where: { shop },
  });

  if (!setting) return true;
  return setting.backInStockEnabled === true;
}

export async function setBackInStockEnabled(db, shop, enabled) {
  return db.shopSetting.upsert({
    where: { shop },
    create: {
      shop,
      backInStockEnabled: enabled,
    },
    update: {
      backInStockEnabled: enabled,
    },
  });
}

export const BACK_IN_STOCK_DISABLED_ERROR =
  "Back in Stock is turned off. New subscriptions are not accepted.";

export const BACK_IN_STOCK_UNAVAILABLE_ERROR =
  "Back in Stock is unavailable right now. Please try again.";

/**
 * Shared gate for storefront and merchant subscription creation.
 * A read failure fails closed and does not create a row.
 */
export async function getSubscriptionCreateBlock(db, shop) {
  try {
    const enabled = await isBackInStockEnabled(db, shop);
    if (!enabled) {
      return {
        blocked: true,
        status: 403,
        error: BACK_IN_STOCK_DISABLED_ERROR,
      };
    }
    return { blocked: false };
  } catch {
    return {
      blocked: true,
      status: 503,
      error: BACK_IN_STOCK_UNAVAILABLE_ERROR,
    };
  }
}
