import { authenticate, unauthenticated } from "../shopify.server";
import db from "../db.server";
import { queueRestockNotifications } from "../services/notifications.server";

export async function action({ request }) {
  let shop;
  let webhookId;
  let webhookRecorded = false;

  try {
    const authenticatedWebhook = await authenticate.webhook(request);
    shop = authenticatedWebhook.shop;
    const { topic, payload } = authenticatedWebhook;

    webhookId = request.headers.get("X-Shopify-Webhook-Id");
    if (!webhookId) {
      return new Response("Missing webhook ID", { status: 400 });
    }

    try {
      await db.processedWebhook.create({
        data: { id: webhookId, shop, topic },
      });
      webhookRecorded = true;
    } catch (error) {
      if (error.code === "P2002") {
        console.log("Duplicate webhook ignored:", webhookId);
        return new Response("Duplicate webhook ignored", { status: 200 });
      }
      throw error;
    }

    try {
      if (topic !== "INVENTORY_LEVELS_UPDATE") {
        return new Response("Ignored webhook topic", { status: 200 });
      }

      const inventoryItemId = payload.inventory_item_id;
      console.log("Inventory webhook received:", {
        shop,
        topic,
        inventoryItemId,
        locationAvailable: payload.available,
      });

      if (inventoryItemId == null) {
        throw new Error("Webhook payload has no inventory item ID.");
      }

      const { admin } = await unauthenticated.admin(shop);

      const itemResponse = await admin.graphql(
        `#graphql
          query VariantForInventoryItem($id: ID!) {
            inventoryItem(id: $id) {
              variant { id }
            }
          }
        `,
        {
          variables: {
            id: `gid://shopify/InventoryItem/${inventoryItemId}`,
          },
        },
      );

      const itemResult = await itemResponse.json();
      if (itemResult.errors?.length) {
        throw new Error(
          `Inventory item lookup failed: ${JSON.stringify(itemResult.errors)}`,
        );
      }

      const variantId = itemResult.data?.inventoryItem?.variant?.id;
      if (!variantId) {
        return new Response("No matching variant found", { status: 200 });
      }

      const variantResponse = await admin.graphql(
        `#graphql
          query VariantStockState($id: ID!) {
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
        { variables: { id: variantId } },
      );

      const variantResult = await variantResponse.json();
      if (variantResult.errors?.length) {
        throw new Error(
          `Variant lookup failed: ${JSON.stringify(variantResult.errors)}`,
        );
      }

      const variant = variantResult.data?.productVariant;
      if (!variant) {
        return new Response("Variant no longer exists", { status: 200 });
      }

      const quantity = variant.inventoryQuantity ?? 0;
      const isInStock = quantity > 0 && variant.availableForSale === true;

      console.log("Current variant stock state:", {
        shop,
        variantId,
        quantity,
        isInStock,
      });

      const previousState = await db.inventoryVariantState.findUnique({
        where: { shop_variantId: { shop, variantId } },
      });

      if (!previousState) {
        await db.inventoryVariantState.create({
          data: { shop, variantId, inventoryQuantity: quantity, isInStock },
        });

        console.log("Initial stock state recorded; no emails sent.", {
          shop,
          variantId,
          isInStock,
        });

        return Response.json({ success: true, initialized: true, sent: 0 });
      }

      await db.inventoryVariantState.update({
        where: { id: previousState.id },
        data: { inventoryQuantity: quantity, isInStock },
      });

      if (!isInStock) {
        await db.backInStockSubscription.updateMany({
          where: { shop, variantId, status: "ACTIVE" },
          data: { notifiedAt: null },
        });

        return Response.json({
          success: true,
          isInStock: false,
          sent: 0,
        });
      }

      if (previousState.isInStock) {
        console.log("Variant was already in stock; no emails sent.", {
          shop,
          variantId,
        });

        return Response.json({ success: true, restocked: false, sent: 0 });
      }

      const subscriptions = await db.backInStockSubscription.findMany({
        where: {
          shop,
          variantId,
          status: "ACTIVE",
          notifiedAt: null,
        },
        select: { id: true, email: true },
      });

      const productUrl =
        variant.product.onlineStoreUrl ||
        `https://${shop}/products/${variant.product.handle}`;

      const restockKey = previousState.updatedAt.toISOString();

      const result = await queueRestockNotifications({
        shop,
        variantId,
        productTitle: variant.product.title,
        productUrl,
        subscriptions,
        restockKey,
      });

      console.log("Back-in-stock notification result:", {
        shop,
        variantId,
        ...result,
      });

      return Response.json({
        success: true,
        restocked: true,
        ...result,
      });
    } catch (error) {
      if (webhookRecorded) {
        await db.processedWebhook.deleteMany({
          where: { id: webhookId, shop },
        });
        webhookRecorded = false;
      }
      throw error;
    }
  } catch (error) {
    console.error("Inventory webhook processing failed:", error);
    return new Response("Webhook processing failed", { status: 500 });
  }
}
