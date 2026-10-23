import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyVariantStockUpdate } from "../app/services/inventory-restock.server.js";
import {
  STALE_PENDING_MS,
  retryFailedNotifications,
} from "../app/services/notifications.server.js";
import {
  getSubscriptionCreateBlock,
  isBackInStockEnabled,
  setBackInStockEnabled,
} from "../app/services/shop-settings.server.js";
import { createBackInStockSubscription } from "../app/services/subscriptions.server.js";
import { createMockDb, recordProcessedWebhook } from "./helpers/mock-db.js";

const shop = "demo.myshopify.com";
const otherShop = "other.myshopify.com";
const productId = "gid://shopify/Product/11";
const variantId = "gid://shopify/ProductVariant/22";

function createAdmin() {
  return {
    async graphql() {
      return {
        async json() {
          return {
            data: {
              productVariant: {
                id: variantId,
                inventoryQuantity: 4,
                availableForSale: true,
                product: {
                  id: productId,
                  title: "Blue Shirt",
                  handle: "blue-shirt",
                  onlineStoreUrl:
                    "https://demo.myshopify.com/products/blue-shirt",
                },
              },
            },
          };
        },
      };
    },
  };
}

function stockVariant(inStock) {
  return {
    id: variantId,
    inventoryQuantity: inStock ? 3 : 0,
    availableForSale: inStock,
    product: {
      title: "Blue Shirt",
      handle: "blue-shirt",
      onlineStoreUrl: "https://demo.myshopify.com/products/blue-shirt",
    },
  };
}

function activeSubscription(id, subscriptionShop = shop) {
  return {
    id,
    shop: subscriptionShop,
    email: `${id}@example.com`,
    productId,
    variantId,
    status: "ACTIVE",
    notifiedAt: null,
  };
}

describe("shop setting defaults", () => {
  it("treats a missing ShopSetting row as enabled", async () => {
    const db = createMockDb();

    assert.equal(await isBackInStockEnabled(db, shop), true);
  });

  it("keeps settings independent for two shops", async () => {
    const db = createMockDb();

    await setBackInStockEnabled(db, shop, false);
    await setBackInStockEnabled(db, otherShop, true);

    assert.equal(await isBackInStockEnabled(db, shop), false);
    assert.equal(await isBackInStockEnabled(db, otherShop), true);
    assert.equal(db.__state.shopSettings.length, 2);
  });
});

describe("new subscriptions while disabled", () => {
  it("rejects storefront creation and writes nothing", async () => {
    const db = createMockDb({
      shopSettings: [{ shop, backInStockEnabled: false }],
    });
    let graphqlCalls = 0;
    const admin = {
      async graphql() {
        graphqlCalls += 1;
        return createAdmin().graphql();
      },
    };

    const result = await createBackInStockSubscription({
      db,
      shop,
      email: "buyer@example.com",
      productId,
      variantId,
      admin,
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
    assert.equal(graphqlCalls, 0);
    assert.equal(db.__state.subscriptions.length, 0);
  });

  it("rejects merchant creation through the same gate", async () => {
    const db = createMockDb({
      shopSettings: [{ shop, backInStockEnabled: false }],
    });

    const block = await getSubscriptionCreateBlock(db, shop);

    assert.equal(block.blocked, true);
    assert.equal(block.status, 403);
    assert.equal(db.__state.subscriptions.length, 0);
    assert.equal(await isBackInStockEnabled(db, otherShop), true);
  });
});

describe("restock and retry while the module is off", () => {
  it("queues a restock without delivering and stays idempotent", async () => {
    const previousUpdatedAt = new Date("2026-03-01T00:00:00.000Z");
    const db = createMockDb({
      shopSettings: [{ shop, backInStockEnabled: false }],
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
      subscriptions: [activeSubscription("sub_1")],
    });
    let sends = 0;

    const firstWebhook = await recordProcessedWebhook(db, {
      id: "wh_disabled",
      shop,
      topic: "INVENTORY_LEVELS_UPDATE",
    });
    const result = await applyVariantStockUpdate({
      shop,
      variant: stockVariant(true),
      dbClient: db,
      sendEmail: async () => {
        sends += 1;
      },
    });
    const duplicateWebhook = await recordProcessedWebhook(db, {
      id: "wh_disabled",
      shop,
      topic: "INVENTORY_LEVELS_UPDATE",
    });

    assert.equal(firstWebhook.duplicate, false);
    assert.equal(duplicateWebhook.duplicate, true);
    assert.equal(db.__state.processedWebhooks.length, 1);
    assert.equal(result.restocked, true);
    assert.equal(result.held, true);
    assert.equal(result.queued, 1);
    assert.equal(result.sent, 0);
    assert.equal(sends, 0);
    assert.equal(db.__state.inventoryStates[0].isInStock, true);
    assert.equal(db.__state.notifications.length, 1);
    assert.equal(db.__state.notifications[0].status, "PENDING");
    assert.equal(db.__state.notifications[0].attempts, 0);
  });

  it("leaves a disabled shop's retry candidate unchanged", async () => {
    const updatedAt = new Date("2026-03-01T00:00:00.000Z");
    const db = createMockDb({
      shopSettings: [{ shop, backInStockEnabled: false }],
      subscriptions: [activeSubscription("sub_1")],
      notifications: [
        {
          id: "note_1",
          shop,
          subscriptionId: "sub_1",
          variantId,
          restockKey: "key-1",
          status: "FAILED",
          attempts: 2,
          lastError: "mailbox full",
          createdAt: updatedAt,
          updatedAt,
          sentAt: null,
        },
      ],
    });

    const before = { ...db.__state.notifications[0] };
    let sends = 0;
    const result = await retryFailedNotifications({
      dbClient: db,
      sendEmail: async () => {
        sends += 1;
      },
      getAdmin: async () => ({ admin: createAdmin() }),
      now: Date.now(),
    });

    assert.equal(sends, 0);
    assert.equal(result.retried, 0);
    assert.equal(result.skipped, 1);
    assert.deepEqual(db.__state.notifications[0], before);
  });

  it("sends an eligible held job after the shop is enabled again", async () => {
    const now = Date.now();
    const createdAt = new Date(now - STALE_PENDING_MS - 1000);
    const db = createMockDb({
      shopSettings: [{ shop, backInStockEnabled: false }],
      subscriptions: [activeSubscription("sub_1")],
      notifications: [
        {
          id: "note_held",
          shop,
          subscriptionId: "sub_1",
          variantId,
          restockKey: "key-held",
          status: "PENDING",
          attempts: 0,
          lastError: null,
          createdAt,
          updatedAt: createdAt,
          sentAt: null,
        },
      ],
    });

    const held = await retryFailedNotifications({
      dbClient: db,
      sendEmail: async () => {
        throw new Error("must not send while disabled");
      },
      getAdmin: async () => ({ admin: createAdmin() }),
      now,
    });

    assert.equal(held.skipped, 1);
    assert.equal(db.__state.notifications[0].status, "PENDING");
    assert.equal(db.__state.notifications[0].attempts, 0);

    await setBackInStockEnabled(db, shop, true);
    let sends = 0;
    const resumed = await retryFailedNotifications({
      dbClient: db,
      sendEmail: async () => {
        sends += 1;
      },
      getAdmin: async () => ({ admin: createAdmin() }),
      now,
    });

    assert.equal(sends, 1);
    assert.equal(resumed.sent, 1);
    assert.equal(db.__state.notifications[0].status, "SENT");
  });

  it("does not send the same job twice when retries overlap", async () => {
    const updatedAt = new Date(Date.now() - 10 * 60 * 1000);
    const db = createMockDb({
      shopSettings: [{ shop, backInStockEnabled: true }],
      subscriptions: [activeSubscription("sub_1")],
      notifications: [
        {
          id: "note_1",
          shop,
          subscriptionId: "sub_1",
          variantId,
          restockKey: "key-1",
          status: "FAILED",
          attempts: 1,
          lastError: "temporary",
          createdAt: updatedAt,
          updatedAt,
          sentAt: null,
        },
      ],
    });
    let sends = 0;
    const options = {
      dbClient: db,
      sendEmail: async () => {
        sends += 1;
      },
      getAdmin: async () => ({ admin: createAdmin() }),
      now: Date.now(),
    };

    const [first, second] = await Promise.all([
      retryFailedNotifications(options),
      retryFailedNotifications(options),
    ]);

    assert.equal(sends, 1);
    assert.equal(first.sent + second.sent, 1);
  });
});

describe("setting read failures", () => {
  it("does not create a subscription when the setting cannot be read", async () => {
    const db = createMockDb({
      shopSettingReadError: new Error("settings unavailable"),
    });

    const result = await createBackInStockSubscription({
      db,
      shop,
      email: "buyer@example.com",
      productId,
      variantId,
      admin: createAdmin(),
    });
    const block = await getSubscriptionCreateBlock(db, shop);

    assert.equal(result.ok, false);
    assert.equal(result.status, 503);
    assert.equal(block.blocked, true);
    assert.equal(block.status, 503);
    assert.equal(db.__state.subscriptions.length, 0);
  });

  it("does not claim a notification when the setting cannot be read", async () => {
    const updatedAt = new Date("2026-03-02T00:00:00.000Z");
    const db = createMockDb({
      shopSettingReadError: new Error("settings unavailable"),
      subscriptions: [activeSubscription("sub_1")],
      notifications: [
        {
          id: "note_1",
          shop,
          subscriptionId: "sub_1",
          variantId,
          restockKey: "key-1",
          status: "PENDING",
          attempts: 0,
          lastError: "keep me",
          createdAt: updatedAt,
          updatedAt,
          sentAt: null,
        },
      ],
    });

    const before = { ...db.__state.notifications[0] };
    const result = await retryFailedNotifications({
      dbClient: db,
      sendEmail: async () => {
        throw new Error("must not send");
      },
      getAdmin: async () => ({ admin: createAdmin() }),
      now: Date.now(),
    });

    assert.equal(result.skipped, 1);
    assert.equal(result.retried, 0);
    assert.deepEqual(db.__state.notifications[0], before);
  });

  it("does not record a restock when the setting cannot be read", async () => {
    const db = createMockDb({
      shopSettingReadError: new Error("settings unavailable"),
      inventoryStates: [
        {
          id: "inv_1",
          shop,
          variantId,
          inventoryQuantity: 0,
          isInStock: false,
          updatedAt: new Date("2026-03-03T00:00:00.000Z"),
        },
      ],
      subscriptions: [activeSubscription("sub_1")],
    });
    let sends = 0;

    await assert.rejects(
      () =>
        applyVariantStockUpdate({
          shop,
          variant: stockVariant(true),
          dbClient: db,
          sendEmail: async () => {
            sends += 1;
          },
        }),
      /settings unavailable/,
    );

    assert.equal(sends, 0);
    assert.equal(db.__state.notifications.length, 0);
    assert.equal(db.__state.inventoryStates[0].isInStock, false);
  });
});

describe("enabled module", () => {
  it("still creates a subscription and sends a restock email", async () => {
    const db = createMockDb({
      shopSettings: [{ shop, backInStockEnabled: true }],
      inventoryStates: [
        {
          id: "inv_1",
          shop,
          variantId,
          inventoryQuantity: 0,
          isInStock: false,
          updatedAt: new Date("2026-03-04T00:00:00.000Z"),
        },
      ],
    });

    const created = await createBackInStockSubscription({
      db,
      shop,
      email: "buyer@example.com",
      productId,
      variantId,
      admin: createAdmin(),
    });

    assert.equal(created.ok, true);
    assert.equal(db.__state.subscriptions.length, 1);

    let sends = 0;
    const restock = await applyVariantStockUpdate({
      shop,
      variant: stockVariant(true),
      dbClient: db,
      sendEmail: async () => {
        sends += 1;
      },
    });

    assert.equal(restock.sent, 1);
    assert.equal(sends, 1);
    assert.equal(db.__state.notifications[0].status, "SENT");
  });
});
