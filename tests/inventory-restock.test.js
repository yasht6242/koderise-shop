import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyVariantStockUpdate } from "../app/services/inventory-restock.server.js";
import {
  enqueueRestockNotifications,
  deliverRestockNotifications,
} from "../app/services/notifications.server.js";
import { createMockDb, recordProcessedWebhook } from "./helpers/mock-db.js";

const shop = "demo.myshopify.com";
const variantId = "gid://shopify/ProductVariant/22";

function inStockVariant(overrides = {}) {
  return {
    id: variantId,
    inventoryQuantity: 3,
    availableForSale: true,
    product: {
      title: "Blue Shirt",
      handle: "blue-shirt",
      onlineStoreUrl: "https://demo.myshopify.com/products/blue-shirt",
    },
    ...overrides,
  };
}

function outOfStockVariant() {
  return inStockVariant({ inventoryQuantity: 0, availableForSale: false });
}

describe("processed webhook idempotency", () => {
  it("ignores a duplicate Shopify webhook id", async () => {
    const db = createMockDb();
    const first = await recordProcessedWebhook(db, {
      id: "wh_1",
      shop,
      topic: "INVENTORY_LEVELS_UPDATE",
    });
    const second = await recordProcessedWebhook(db, {
      id: "wh_1",
      shop,
      topic: "INVENTORY_LEVELS_UPDATE",
    });

    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    assert.equal(db.__state.processedWebhooks.length, 1);
  });
});

describe("applyVariantStockUpdate durability", () => {
  it("records an initial stock observation without notifications", async () => {
    const db = createMockDb();
    const emails = [];

    const result = await applyVariantStockUpdate({
      shop,
      variant: inStockVariant(),
      dbClient: db,
      sendEmail: async (payload) => {
        emails.push(payload);
      },
    });

    assert.equal(result.initialized, true);
    assert.equal(result.queued, 0);
    assert.equal(db.__state.notifications.length, 0);
    assert.equal(emails.length, 0);
  });

  it("creates durable jobs before marking the variant in stock", async () => {
    const previousUpdatedAt = new Date("2026-01-01T00:00:00.000Z");
    const db = createMockDb({
      inventoryStates: [
        {
          id: "inv_1",
          shop,
          variantId,
          inventoryQuantity: 0,
          isInStock: false,
          updatedAt: previousUpdatedAt,
        },
      ],
      subscriptions: [
        {
          id: "sub_1",
          shop,
          email: "buyer@example.com",
          productId: "gid://shopify/Product/11",
          variantId,
          status: "ACTIVE",
          notifiedAt: null,
        },
      ],
    });

    let stateWhenQueued = null;

    const result = await applyVariantStockUpdate({
      shop,
      variant: inStockVariant(),
      dbClient: db,
      enqueue: async (args) => {
        stateWhenQueued = await db.inventoryVariantState.findUnique({
          where: { shop_variantId: { shop, variantId } },
        });
        return enqueueRestockNotifications(args);
      },
      deliver: async () => ({ sent: 0, failed: 0, skipped: 0 }),
      sendEmail: async () => {
        throw new Error("send should not run in this assertion path");
      },
    });

    assert.equal(result.restocked, true);
    assert.equal(result.queued, 1);
    assert.equal(stateWhenQueued.isInStock, false);
    assert.equal(db.__state.inventoryStates[0].isInStock, true);
    assert.equal(db.__state.notifications.length, 1);
    assert.equal(db.__state.notifications[0].status, "PENDING");
    assert.equal(
      db.__state.notifications[0].restockKey,
      previousUpdatedAt.toISOString(),
    );
  });

  it("keeps jobs if delivery fails after the restock is recorded", async () => {
    const db = createMockDb({
      inventoryStates: [
        {
          id: "inv_1",
          shop,
          variantId,
          inventoryQuantity: 0,
          isInStock: false,
          updatedAt: new Date("2026-01-02T00:00:00.000Z"),
        },
      ],
      subscriptions: [
        {
          id: "sub_1",
          shop,
          email: "buyer@example.com",
          productId: "gid://shopify/Product/11",
          variantId,
          status: "ACTIVE",
          notifiedAt: null,
        },
      ],
    });

    const result = await applyVariantStockUpdate({
      shop,
      variant: inStockVariant(),
      dbClient: db,
      enqueue: enqueueRestockNotifications,
      deliver: deliverRestockNotifications,
      sendEmail: async () => {
        throw new Error("Resend unavailable");
      },
    });

    assert.equal(result.restocked, true);
    assert.equal(result.queued, 1);
    assert.equal(result.failed, 1);
    assert.equal(db.__state.inventoryStates[0].isInStock, true);
    assert.equal(db.__state.notifications[0].status, "FAILED");
  });

  it("does not create a second restock cycle when already in stock", async () => {
    const db = createMockDb({
      inventoryStates: [
        {
          id: "inv_1",
          shop,
          variantId,
          inventoryQuantity: 2,
          isInStock: true,
          updatedAt: new Date("2026-01-03T00:00:00.000Z"),
        },
      ],
      subscriptions: [
        {
          id: "sub_1",
          shop,
          email: "buyer@example.com",
          productId: "gid://shopify/Product/11",
          variantId,
          status: "ACTIVE",
          notifiedAt: null,
        },
      ],
    });

    const result = await applyVariantStockUpdate({
      shop,
      variant: inStockVariant({ inventoryQuantity: 5 }),
      dbClient: db,
      sendEmail: async () => {},
    });

    assert.equal(result.restocked, false);
    assert.equal(db.__state.notifications.length, 0);
  });

  it("re-arms subscriptions when stock goes out again", async () => {
    const db = createMockDb({
      inventoryStates: [
        {
          id: "inv_1",
          shop,
          variantId,
          inventoryQuantity: 2,
          isInStock: true,
          updatedAt: new Date(),
        },
      ],
      subscriptions: [
        {
          id: "sub_1",
          shop,
          email: "buyer@example.com",
          productId: "gid://shopify/Product/11",
          variantId,
          status: "ACTIVE",
          notifiedAt: new Date(),
        },
      ],
    });

    await applyVariantStockUpdate({
      shop,
      variant: outOfStockVariant(),
      dbClient: db,
      sendEmail: async () => {},
    });

    assert.equal(db.__state.inventoryStates[0].isInStock, false);
    assert.equal(db.__state.subscriptions[0].notifiedAt, null);
  });

  it("does not create duplicate jobs for the same restock key", async () => {
    const restockKey = new Date("2026-01-04T00:00:00.000Z").toISOString();
    const db = createMockDb({
      inventoryStates: [
        {
          id: "inv_1",
          shop,
          variantId,
          inventoryQuantity: 0,
          isInStock: false,
          updatedAt: new Date(restockKey),
        },
      ],
      subscriptions: [
        {
          id: "sub_1",
          shop,
          email: "buyer@example.com",
          productId: "gid://shopify/Product/11",
          variantId,
          status: "ACTIVE",
          notifiedAt: null,
        },
      ],
      notifications: [
        {
          id: "note_existing",
          shop,
          subscriptionId: "sub_1",
          variantId,
          restockKey,
          status: "PENDING",
          attempts: 0,
          lastError: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          sentAt: null,
        },
      ],
    });

    const result = await applyVariantStockUpdate({
      shop,
      variant: inStockVariant(),
      dbClient: db,
      enqueue: enqueueRestockNotifications,
      deliver: async () => ({ sent: 0, failed: 0, skipped: 0 }),
      sendEmail: async () => {},
    });

    assert.equal(result.queued, 0);
    assert.equal(result.alreadyQueued, 1);
    assert.equal(db.__state.notifications.length, 1);
  });
});
