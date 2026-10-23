import db from "../db.server.js";
import { sendBackInStockEmail } from "./email.server.js";
import { isBackInStockEnabled } from "./shop-settings.server.js";

async function defaultGetAdmin(shop) {
  const { unauthenticated } = await import("../shopify.server.js");
  return unauthenticated.admin(shop);
}

export const MAX_NOTIFICATION_ATTEMPTS = 5;
export const STALE_SENDING_MS = 10 * 60 * 1000;
// Leave fresh PENDING rows to the webhook. Only recover ones that have sat
// unclaimed long enough that the webhook is no longer processing them.
export const STALE_PENDING_MS = 2 * 60 * 1000;

/**
 * Durably create PENDING notification jobs for a restock cycle.
 * Unique (subscriptionId, restockKey) prevents duplicate jobs.
 */
export async function enqueueRestockNotifications({
  shop,
  variantId,
  subscriptions,
  restockKey,
  dbClient = db,
}) {
  let queued = 0;
  let alreadyQueued = 0;

  for (const subscription of subscriptions) {
    try {
      await dbClient.backInStockNotification.create({
        data: {
          shop,
          subscriptionId: subscription.id,
          variantId,
          restockKey,
          status: "PENDING",
        },
      });

      queued++;
    } catch (error) {
      if (error.code === "P2002") {
        alreadyQueued++;
        console.log("Notification already queued:", {
          subscriptionId: subscription.id,
          restockKey,
        });
        continue;
      }

      throw error;
    }
  }

  return { queued, alreadyQueued };
}

async function markNotificationTerminalFailure(
  dbClient,
  notificationId,
  lastError,
) {
  await dbClient.backInStockNotification.update({
    where: { id: notificationId },
    data: {
      status: "FAILED",
      attempts: MAX_NOTIFICATION_ATTEMPTS,
      lastError: String(lastError).slice(0, 1000),
    },
  });
}

async function deliverOneNotification({
  notification,
  shop,
  productTitle,
  productUrl,
  dbClient,
  sendEmail,
}) {
  const claim = await dbClient.backInStockNotification.updateMany({
    where: {
      id: notification.id,
      status: notification.status,
    },
    data: {
      status: "SENDING",
      attempts: { increment: 1 },
      lastError: null,
    },
  });

  if (claim.count !== 1) {
    return { outcome: "skipped" };
  }

  try {
    const subscription = await dbClient.backInStockSubscription.findFirst({
      where: {
        id: notification.subscriptionId,
        shop,
        status: "ACTIVE",
      },
    });

    if (!subscription) {
      await markNotificationTerminalFailure(
        dbClient,
        notification.id,
        "Subscription is missing or inactive.",
      );
      return { outcome: "failed" };
    }

    await sendEmail({
      to: subscription.email,
      productTitle,
      productUrl,
    });

    await dbClient.$transaction([
      dbClient.backInStockNotification.update({
        where: { id: notification.id },
        data: {
          status: "SENT",
          sentAt: new Date(),
          lastError: null,
        },
      }),
      dbClient.backInStockSubscription.updateMany({
        where: {
          id: subscription.id,
          shop,
          status: "ACTIVE",
          notifiedAt: null,
        },
        data: { notifiedAt: new Date() },
      }),
    ]);

    return { outcome: "sent" };
  } catch (error) {
    await dbClient.backInStockNotification.update({
      where: { id: notification.id },
      data: {
        status: "FAILED",
        lastError: String(error.message || error).slice(0, 1000),
      },
    });

    console.error("Notification delivery failed:", {
      notificationId: notification.id,
      message: error.message,
    });

    return { outcome: "failed" };
  }
}

/**
 * Claim and send PENDING/FAILED jobs for a restock cycle.
 */
export async function deliverRestockNotifications({
  shop,
  variantId,
  productTitle,
  productUrl,
  restockKey,
  dbClient = db,
  sendEmail = sendBackInStockEmail,
}) {
  const pending = await dbClient.backInStockNotification.findMany({
    where: {
      shop,
      variantId,
      restockKey,
      status: { in: ["PENDING", "FAILED"] },
      attempts: { lt: MAX_NOTIFICATION_ATTEMPTS },
    },
    orderBy: { createdAt: "asc" },
  });

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const notification of pending) {
    const result = await deliverOneNotification({
      notification,
      shop,
      productTitle,
      productUrl,
      dbClient,
      sendEmail,
    });

    if (result.outcome === "sent") sent++;
    else if (result.outcome === "failed") failed++;
    else skipped++;
  }

  return { sent, failed, skipped };
}

/**
 * Enqueue jobs, then attempt delivery. Used after inventory state is updated.
 */
export async function queueRestockNotifications({
  shop,
  variantId,
  productTitle,
  productUrl,
  subscriptions,
  restockKey,
  dbClient = db,
  sendEmail = sendBackInStockEmail,
}) {
  const enqueueResult = await enqueueRestockNotifications({
    shop,
    variantId,
    subscriptions,
    restockKey,
    dbClient,
  });

  const deliverResult = await deliverRestockNotifications({
    shop,
    variantId,
    productTitle,
    productUrl,
    restockKey,
    dbClient,
    sendEmail,
  });

  return {
    queued: enqueueResult.queued,
    alreadyQueued: enqueueResult.alreadyQueued,
    ...deliverResult,
  };
}

function backoffMsForAttempts(attempts) {
  // Exponential delay: 1, 2, 4, then 8 minutes based on attempts already made.
  return 60 * 1000 * 2 ** Math.max(0, attempts - 1);
}

export async function retryFailedNotifications({
  limit = 50,
  dbClient = db,
  sendEmail = sendBackInStockEmail,
  getAdmin = defaultGetAdmin,
  now = Date.now(),
} = {}) {
  const staleSendingBefore = new Date(now - STALE_SENDING_MS);
  const stalePendingBefore = new Date(now - STALE_PENDING_MS);

  const candidates = await dbClient.backInStockNotification.findMany({
    where: {
      attempts: { lt: MAX_NOTIFICATION_ATTEMPTS },
      OR: [
        { status: "FAILED" },
        {
          status: "SENDING",
          updatedAt: { lt: staleSendingBefore },
        },
        {
          status: "PENDING",
          createdAt: { lt: stalePendingBefore },
        },
      ],
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
  });

  let retried = 0;
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const notification of candidates) {
    try {
      const enabled = await isBackInStockEnabled(
        dbClient,
        notification.shop,
      );
      if (!enabled) {
        skipped++;
        continue;
      }
    } catch {
      skipped++;
      continue;
    }

    if (notification.status === "FAILED") {
      const delayMs = backoffMsForAttempts(notification.attempts);

      if (now - notification.updatedAt.getTime() < delayMs) {
        skipped++;
        continue;
      }
    }

    const claim = await dbClient.backInStockNotification.updateMany({
      where: {
        id: notification.id,
        status: notification.status,
        updatedAt: notification.updatedAt,
        attempts: { lt: MAX_NOTIFICATION_ATTEMPTS },
      },
      data: {
        status: "SENDING",
        attempts: { increment: 1 },
        lastError: null,
      },
    });

    if (claim.count !== 1) {
      skipped++;
      continue;
    }

    retried++;

    try {
      const subscription = await dbClient.backInStockSubscription.findFirst({
        where: {
          id: notification.subscriptionId,
          shop: notification.shop,
          status: "ACTIVE",
        },
      });

      if (!subscription) {
        await markNotificationTerminalFailure(
          dbClient,
          notification.id,
          "Subscription is missing or inactive.",
        );
        failed++;
        continue;
      }

      const { admin } = await getAdmin(notification.shop);

      const response = await admin.graphql(
        `#graphql
          query RetryNotificationProduct($id: ID!) {
            productVariant(id: $id) {
              id
              inventoryQuantity
              availableForSale
              product {
                title
                handle
                onlineStoreUrl
              }
            }
          }
        `,
        { variables: { id: notification.variantId } },
      );

      const result = await response.json();

      if (result.errors?.length) {
        throw new Error(
          `Product lookup failed: ${JSON.stringify(result.errors)}`,
        );
      }

      const variant = result.data?.productVariant;

      if (!variant) {
        await markNotificationTerminalFailure(
          dbClient,
          notification.id,
          "Product variant no longer exists.",
        );
        failed++;
        continue;
      }

      // Do not email if the item is out of stock again.
      // Restore the attempt count from before this claim so a scheduler
      // cannot use up the five-attempt limit while the product is unavailable.
      if (
        (variant.inventoryQuantity ?? 0) <= 0 ||
        variant.availableForSale !== true
      ) {
        await dbClient.backInStockNotification.update({
          where: { id: notification.id },
          data: {
            status: "FAILED",
            attempts: notification.attempts,
            lastError: "Retry skipped because the product is out of stock.",
          },
        });

        failed++;
        continue;
      }

      const productUrl =
        variant.product.onlineStoreUrl ||
        `https://${notification.shop}/products/${variant.product.handle}`;

      await sendEmail({
        to: subscription.email,
        productTitle: variant.product.title,
        productUrl,
      });

      await dbClient.$transaction([
        dbClient.backInStockNotification.update({
          where: { id: notification.id },
          data: {
            status: "SENT",
            sentAt: new Date(),
            lastError: null,
          },
        }),
        dbClient.backInStockSubscription.updateMany({
          where: {
            id: subscription.id,
            shop: notification.shop,
            status: "ACTIVE",
            notifiedAt: null,
          },
          data: { notifiedAt: new Date() },
        }),
      ]);

      sent++;
    } catch (error) {
      await dbClient.backInStockNotification.update({
        where: { id: notification.id },
        data: {
          status: "FAILED",
          lastError: String(error.message || error).slice(0, 1000),
        },
      });

      failed++;

      console.error("Notification retry failed:", {
        notificationId: notification.id,
        attempts: notification.attempts + 1,
        message: error.message,
      });
    }
  }

  return { retried, sent, failed, skipped };
}
