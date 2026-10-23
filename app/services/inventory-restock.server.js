import {
  deliverRestockNotifications,
  enqueueRestockNotifications,
} from "./notifications.server.js";
import { isBackInStockEnabled } from "./shop-settings.server.js";

/**
 * Apply an inventory stock snapshot for one variant.
 *
 * Durability rule for restocks:
 * 1. Detect out-of-stock -> in-stock
 * 2. Create notification jobs first
 * 3. Only then mark InventoryVariantState as in stock
 * 4. Attempt email delivery (failures remain retryable)
 *
 * This is not exactly-once email delivery. If the email provider accepts a
 * message and the database update fails, a later retry may send again.
 */
export async function applyVariantStockUpdate({
  shop,
  variant,
  dbClient,
  enqueue = enqueueRestockNotifications,
  deliver = deliverRestockNotifications,
  sendEmail,
}) {
  const variantId = variant.id;
  const quantity = variant.inventoryQuantity ?? 0;
  const isInStock = quantity > 0 && variant.availableForSale === true;
  const backInStockEnabled = await isBackInStockEnabled(dbClient, shop);

  const previousState = await dbClient.inventoryVariantState.findUnique({
    where: { shop_variantId: { shop, variantId } },
  });

  if (!previousState) {
    await dbClient.inventoryVariantState.create({
      data: { shop, variantId, inventoryQuantity: quantity, isInStock },
    });

    return {
      success: true,
      initialized: true,
      restocked: false,
      queued: 0,
      sent: 0,
      failed: 0,
    };
  }

  // Still / newly out of stock: update state and re-arm subscriptions.
  if (!isInStock) {
    await dbClient.inventoryVariantState.update({
      where: { id: previousState.id },
      data: { inventoryQuantity: quantity, isInStock },
    });

    await dbClient.backInStockSubscription.updateMany({
      where: { shop, variantId, status: "ACTIVE" },
      data: { notifiedAt: null },
    });

    return {
      success: true,
      isInStock: false,
      restocked: false,
      queued: 0,
      sent: 0,
      failed: 0,
    };
  }

  // Already in stock: refresh quantity only. Do not create a new restock cycle.
  if (previousState.isInStock) {
    await dbClient.inventoryVariantState.update({
      where: { id: previousState.id },
      data: { inventoryQuantity: quantity, isInStock },
    });

    return {
      success: true,
      restocked: false,
      queued: 0,
      sent: 0,
      failed: 0,
    };
  }

  // Restock transition: queue jobs BEFORE flipping isInStock.
  const restockKey = previousState.updatedAt.toISOString();

  const subscriptions = await dbClient.backInStockSubscription.findMany({
    where: {
      shop,
      variantId,
      status: "ACTIVE",
      notifiedAt: null,
    },
    select: { id: true },
  });

  const enqueueResult = await enqueue({
    shop,
    variantId,
    subscriptions,
    restockKey,
    dbClient,
  });

  // Jobs are durable. Now mark the variant in stock for this cycle.
  await dbClient.inventoryVariantState.update({
    where: { id: previousState.id },
    data: { inventoryQuantity: quantity, isInStock },
  });

  if (!backInStockEnabled) {
    return {
      success: true,
      restocked: true,
      held: true,
      restockKey,
      queued: enqueueResult.queued,
      alreadyQueued: enqueueResult.alreadyQueued,
      sent: 0,
      failed: 0,
      skipped: 0,
    };
  }

  const productUrl =
    variant.product.onlineStoreUrl ||
    `https://${shop}/products/${variant.product.handle}`;

  const deliverResult = await deliver({
    shop,
    variantId,
    productTitle: variant.product.title,
    productUrl,
    restockKey,
    dbClient,
    sendEmail,
  });

  return {
    success: true,
    restocked: true,
    restockKey,
    queued: enqueueResult.queued,
    alreadyQueued: enqueueResult.alreadyQueued,
    sent: deliverResult.sent,
    failed: deliverResult.failed,
    skipped: deliverResult.skipped,
  };
}
