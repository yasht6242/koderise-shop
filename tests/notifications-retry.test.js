import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_NOTIFICATION_ATTEMPTS,
  STALE_PENDING_MS,
  deliverRestockNotifications,
  retryFailedNotifications,
} from "../app/services/notifications.server.js";
import { createMockDb } from "./helpers/mock-db.js";

const shop = "demo.myshopify.com";
const variantId = "gid://shopify/ProductVariant/22";

function createAdmin({ quantity = 4, availableForSale = true, missing = false } = {}) {
  return {
    async graphql() {
      return {
        async json() {
          if (missing) {
            return { data: { productVariant: null } };
          }

          return {
            data: {
              productVariant: {
                id: variantId,
                inventoryQuantity: quantity,
                availableForSale,
                product: {
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

describe("notification delivery claims", () => {
  it("prevents concurrent workers from sending the same job", async () => {
    const updatedAt = new Date("2026-02-01T00:00:00.000Z");
    const db = createMockDb({
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
          id: "note_1",
          shop,
          subscriptionId: "sub_1",
          variantId,
          restockKey: "key-1",
          status: "PENDING",
          attempts: 0,
          lastError: null,
          createdAt: updatedAt,
          updatedAt,
          sentAt: null,
        },
      ],
    });

    let sendCount = 0;
    const sendEmail = async () => {
      sendCount += 1;
    };

    const [first, second] = await Promise.all([
      deliverRestockNotifications({
        shop,
        variantId,
        productTitle: "Blue Shirt",
        productUrl: "https://example.com/p",
        restockKey: "key-1",
        dbClient: db,
        sendEmail,
      }),
      deliverRestockNotifications({
        shop,
        variantId,
        productTitle: "Blue Shirt",
        productUrl: "https://example.com/p",
        restockKey: "key-1",
        dbClient: db,
        sendEmail,
      }),
    ]);

    assert.equal(sendCount, 1);
    assert.equal(first.sent + second.sent, 1);
    assert.equal(db.__state.notifications[0].status, "SENT");
  });
});

describe("retryFailedNotifications", () => {
  it("retries a FAILED job that is past backoff", async () => {
    const updatedAt = new Date(Date.now() - 10 * 60 * 1000);
    const db = createMockDb({
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

    const emails = [];
    const result = await retryFailedNotifications({
      dbClient: db,
      sendEmail: async (payload) => {
        emails.push(payload.to);
      },
      getAdmin: async () => ({ admin: createAdmin() }),
      now: Date.now(),
    });

    assert.equal(result.sent, 1);
    assert.equal(emails.length, 1);
    assert.equal(db.__state.notifications[0].status, "SENT");
  });

  it("recovers a stale SENDING job", async () => {
    const updatedAt = new Date(Date.now() - 20 * 60 * 1000);
    const db = createMockDb({
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
          id: "note_1",
          shop,
          subscriptionId: "sub_1",
          variantId,
          restockKey: "key-1",
          status: "SENDING",
          attempts: 1,
          lastError: null,
          createdAt: updatedAt,
          updatedAt,
          sentAt: null,
        },
      ],
    });

    const result = await retryFailedNotifications({
      dbClient: db,
      sendEmail: async () => {},
      getAdmin: async () => ({ admin: createAdmin() }),
      now: Date.now(),
    });

    assert.equal(result.retried, 1);
    assert.equal(result.sent, 1);
    assert.equal(db.__state.notifications[0].status, "SENT");
  });

  it("does not email cancelled subscriptions", async () => {
    const updatedAt = new Date(Date.now() - 10 * 60 * 1000);
    const db = createMockDb({
      subscriptions: [
        {
          id: "sub_1",
          shop,
          email: "buyer@example.com",
          productId: "gid://shopify/Product/11",
          variantId,
          status: "CANCELLED",
          notifiedAt: null,
        },
      ],
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

    let sendCount = 0;
    const result = await retryFailedNotifications({
      dbClient: db,
      sendEmail: async () => {
        sendCount += 1;
      },
      getAdmin: async () => ({ admin: createAdmin() }),
      now: Date.now(),
    });

    assert.equal(sendCount, 0);
    assert.equal(result.failed, 1);
    assert.equal(db.__state.notifications[0].status, "FAILED");
    assert.equal(
      db.__state.notifications[0].attempts,
      MAX_NOTIFICATION_ATTEMPTS,
    );
  });

  it("does not email when the product is still out of stock", async () => {
    const updatedAt = new Date(Date.now() - 10 * 60 * 1000);
    const db = createMockDb({
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

    let sendCount = 0;
    const result = await retryFailedNotifications({
      dbClient: db,
      sendEmail: async () => {
        sendCount += 1;
      },
      getAdmin: async () => ({
        admin: createAdmin({ quantity: 0, availableForSale: false }),
      }),
      now: Date.now(),
    });

    assert.equal(sendCount, 0);
    assert.equal(result.failed, 1);
    assert.equal(db.__state.notifications[0].attempts, 1);
    assert.match(
      db.__state.notifications[0].lastError,
      /out of stock/i,
    );
  });

  it("can still send after an out-of-stock skip once the product is available", async () => {
    const updatedAt = new Date(Date.now() - 10 * 60 * 1000);
    const db = createMockDb({
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

    let availableForSale = false;
    let sendCount = 0;
    const baseOptions = {
      dbClient: db,
      sendEmail: async () => {
        sendCount += 1;
      },
      getAdmin: async () => ({
        admin: createAdmin({
          quantity: availableForSale ? 4 : 0,
          availableForSale,
        }),
      }),
    };

    const now = Date.now();
    await retryFailedNotifications({ ...baseOptions, now });
    assert.equal(sendCount, 0);
    assert.equal(db.__state.notifications[0].attempts, 1);

    availableForSale = true;
    const later = await retryFailedNotifications({
      ...baseOptions,
      now: now + 61 * 1000,
    });

    assert.equal(sendCount, 1);
    assert.equal(later.sent, 1);
    assert.equal(db.__state.notifications[0].status, "SENT");
    assert.equal(db.__state.notifications[0].attempts, 2);
  });

  it("respects exponential backoff and skips early retries", async () => {
    const updatedAt = new Date(Date.now() - 10 * 1000);
    const db = createMockDb({
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

    let sendCount = 0;
    const result = await retryFailedNotifications({
      dbClient: db,
      sendEmail: async () => {
        sendCount += 1;
      },
      getAdmin: async () => ({ admin: createAdmin() }),
      now: Date.now(),
    });

    assert.equal(sendCount, 0);
    assert.equal(result.skipped, 1);
    assert.equal(db.__state.notifications[0].status, "FAILED");
  });

  it("prevents concurrent retries from claiming the same job", async () => {
    const updatedAt = new Date(Date.now() - 10 * 60 * 1000);
    const db = createMockDb({
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

    let sendCount = 0;
    const options = {
      dbClient: db,
      sendEmail: async () => {
        sendCount += 1;
      },
      getAdmin: async () => ({ admin: createAdmin() }),
      now: Date.now(),
    };

    const [first, second] = await Promise.all([
      retryFailedNotifications(options),
      retryFailedNotifications(options),
    ]);

    assert.equal(sendCount, 1);
    assert.equal(first.sent + second.sent, 1);
    assert.equal(first.retried + second.retried, 1);
  });

  it("does not retry a job that is already SENT", async () => {
    const updatedAt = new Date(Date.now() - 60 * 60 * 1000);
    const db = createMockDb({
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
          id: "note_1",
          shop,
          subscriptionId: "sub_1",
          variantId,
          restockKey: "key-1",
          status: "SENT",
          attempts: 1,
          lastError: null,
          createdAt: updatedAt,
          updatedAt,
          sentAt: updatedAt,
        },
      ],
    });

    let sendCount = 0;
    const result = await retryFailedNotifications({
      dbClient: db,
      sendEmail: async () => {
        sendCount += 1;
      },
      getAdmin: async () => ({ admin: createAdmin() }),
      now: Date.now(),
    });

    assert.equal(sendCount, 0);
    assert.equal(result.retried, 0);
    assert.equal(db.__state.notifications[0].status, "SENT");
  });

  it("recovers a stale PENDING job and leaves a fresh PENDING job alone", async () => {
    const now = Date.now();
    const db = createMockDb({
      subscriptions: [
        {
          id: "sub_stale",
          shop,
          email: "stale@example.com",
          productId: "gid://shopify/Product/11",
          variantId,
          status: "ACTIVE",
          notifiedAt: null,
        },
        {
          id: "sub_fresh",
          shop,
          email: "fresh@example.com",
          productId: "gid://shopify/Product/11",
          variantId,
          status: "ACTIVE",
          notifiedAt: null,
        },
      ],
      notifications: [
        {
          id: "note_stale",
          shop,
          subscriptionId: "sub_stale",
          variantId,
          restockKey: "key-stale",
          status: "PENDING",
          attempts: 0,
          lastError: null,
          createdAt: new Date(now - STALE_PENDING_MS - 1000),
          updatedAt: new Date(now - STALE_PENDING_MS - 1000),
          sentAt: null,
        },
        {
          id: "note_fresh",
          shop,
          subscriptionId: "sub_fresh",
          variantId,
          restockKey: "key-fresh",
          status: "PENDING",
          attempts: 0,
          lastError: null,
          createdAt: new Date(now - 1000),
          updatedAt: new Date(now - 1000),
          sentAt: null,
        },
      ],
    });

    const sentTo = [];
    const result = await retryFailedNotifications({
      dbClient: db,
      sendEmail: async ({ to }) => {
        sentTo.push(to);
      },
      getAdmin: async () => ({ admin: createAdmin() }),
      now,
    });

    assert.deepEqual(sentTo, ["stale@example.com"]);
    assert.equal(result.sent, 1);
    assert.equal(
      db.__state.notifications.find((row) => row.id === "note_stale").status,
      "SENT",
    );
    assert.equal(
      db.__state.notifications.find((row) => row.id === "note_fresh").status,
      "PENDING",
    );
    assert.equal(
      db.__state.notifications.find((row) => row.id === "note_fresh").attempts,
      0,
    );
  });
});
