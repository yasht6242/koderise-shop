
import db from "../db.server";
import { sendBackInStockEmail } from "./email.server";
import { unauthenticated } from "../shopify.server";

export async function queueRestockNotifications({
  shop,
  variantId,
  productTitle,
  productUrl,
  subscriptions,
  restockKey,
}) {
  let queued = 0;

  for (const subscription of subscriptions) {
    try {
      await db.backInStockNotification.create({
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
      // A unique-constraint conflict means this subscription
      // already has a notification for this restock cycle.
      if (error.code === "P2002") {
        console.log("Notification already queued:", {
          subscriptionId: subscription.id,
          restockKey,
        });
        continue;
      }

      throw error;
    }
  }

  const pending = await db.backInStockNotification.findMany({
    where: {
      shop,
      variantId,
      restockKey,
      status: { in: ["PENDING", "FAILED"] },
    },
    orderBy: { createdAt: "asc" },
  });

  let sent = 0;
  let failed = 0;

  for (const notification of pending) {
    // Claim the record atomically so two workers don't process
    // the same pending notification simultaneously.
    const claim = await db.backInStockNotification.updateMany({
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

    if (claim.count !== 1) continue;

    try {
      const subscription = await db.backInStockSubscription.findFirst({
        where: {
          id: notification.subscriptionId,
          shop,
          status: "ACTIVE",
        },
      });

      if (!subscription) {
        await db.backInStockNotification.update({
          where: { id: notification.id },
          data: {
            status: "FAILED",
            lastError: "Subscription is missing or inactive.",
          },
        });
        failed++;
        continue;
      }

      await sendBackInStockEmail({
        to: subscription.email,
        productTitle,
        productUrl,
      });

      await db.$transaction([
        db.backInStockNotification.update({
          where: { id: notification.id },
          data: {
            status: "SENT",
            sentAt: new Date(),
            lastError: null,
          },
        }),
        db.backInStockSubscription.updateMany({
          where: {
            id: subscription.id,
            shop,
            status: "ACTIVE",
            notifiedAt: null,
          },
          data: { notifiedAt: new Date() },
        }),
      ]);

      sent++;
    } catch (error) {
      await db.backInStockNotification.update({
        where: { id: notification.id },
        data: {
          status: "FAILED",
          lastError: String(error.message || error).slice(0, 1000),
        },
      });

      failed++;

      console.error("Notification delivery failed:", {
        notificationId: notification.id,
        message: error.message,
      });
    }
  }

  return { queued, sent, failed };
}


export async function retryFailedNotifications({ limit = 50 } = {}) {
  const now = Date.now();
  const staleSendingBefore = new Date(now - 10 * 60 * 1000);

  const candidates = await db.backInStockNotification.findMany({
    where: {
      attempts: { lt: 5 },
      OR: [
        {
          status: "FAILED",
        },
        {
          status: "SENDING",
          updatedAt: { lt: staleSendingBefore },
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
    // Exponential delay: 1, 2, 4, then 8 minutes.
    if (notification.status === "FAILED") {
      const delayMs =
        60 * 1000 * 2 ** Math.max(0, notification.attempts - 1);

      if (now - notification.updatedAt.getTime() < delayMs) {
        skipped++;
        continue;
      }
    }

    // Claim the record so concurrent workers do not retry it together.
    const claim = await db.backInStockNotification.updateMany({
      where: {
        id: notification.id,
        status: notification.status,
        updatedAt: notification.updatedAt,
        attempts: { lt: 5 },
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
      const subscription = await db.backInStockSubscription.findFirst({
        where: {
          id: notification.subscriptionId,
          shop: notification.shop,
          status: "ACTIVE",
        },
      });

      if (!subscription) {
        throw new Error("Subscription is missing or inactive.");
      }

      const { admin } = await unauthenticated.admin(notification.shop);

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
        throw new Error("Product variant no longer exists.");
      }

      // Do not send a delayed restock email if the item is out of stock again.
      if (
        (variant.inventoryQuantity ?? 0) <= 0 ||
        variant.availableForSale !== true
      ) {
        await db.backInStockNotification.update({
          where: { id: notification.id },
          data: {
            status: "FAILED",
            lastError: "Retry skipped because the product is out of stock.",
          },
        });

        failed++;
        continue;
      }

      const productUrl =
        variant.product.onlineStoreUrl ||
        `https://${notification.shop}/products/${variant.product.handle}`;

     await sendBackInStockEmail({
        to: subscription.email,
        productTitle: variant.product.title,
        productUrl,
    });

      await db.$transaction([
        db.backInStockNotification.update({
          where: { id: notification.id },
          data: {
            status: "SENT",
            sentAt: new Date(),
            lastError: null,
          },
        }),
        db.backInStockSubscription.updateMany({
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
      await db.backInStockNotification.update({
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
