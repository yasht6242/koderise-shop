import { authenticate, unauthenticated } from "../shopify.server";
import db from "../db.server";
import { applyVariantStockUpdate } from "../services/inventory-restock.server";

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

      console.log("Current variant stock state:", {
        shop,
        variantId,
        quantity: variant.inventoryQuantity ?? 0,
        isInStock:
          (variant.inventoryQuantity ?? 0) > 0 &&
          variant.availableForSale === true,
      });

      const result = await applyVariantStockUpdate({
        shop,
        variant,
        dbClient: db,
      });

      console.log("Back-in-stock notification result:", {
        shop,
        variantId,
        initialized: result.initialized,
        restocked: result.restocked,
        queued: result.queued,
        sent: result.sent,
        failed: result.failed,
      });

      return Response.json(result);
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
    console.error("Inventory webhook processing failed:", {
      message: error.message,
    });
    return new Response("Webhook processing failed", { status: 500 });
  }
}
