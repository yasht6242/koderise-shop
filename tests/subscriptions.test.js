import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createBackInStockSubscription,
  validateSubscriptionFields,
  normalizeSubscriptionFields,
} from "../app/services/subscriptions.server.js";
import { createMockDb } from "./helpers/mock-db.js";

function createAdmin({ productId, variantId, missing = false } = {}) {
  return {
    async graphql() {
      if (missing) {
        return {
          async json() {
            return { data: { productVariant: null } };
          },
        };
      }

      return {
        async json() {
          return {
            data: {
              productVariant: {
                id: variantId,
                product: { id: productId },
              },
            },
          };
        },
      };
    },
  };
}

describe("subscription field validation", () => {
  it("accepts a valid email and Shopify GIDs", () => {
    const fields = normalizeSubscriptionFields({
      email: "  Buyer@Example.COM ",
      productId: "gid://shopify/Product/1",
      variantId: "gid://shopify/ProductVariant/2",
    });

    assert.equal(fields.email, "buyer@example.com");
    assert.equal(validateSubscriptionFields(fields).ok, true);
  });

  it("rejects an invalid email", () => {
    const result = validateSubscriptionFields({
      email: "not-an-email",
      productId: "gid://shopify/Product/1",
      variantId: "gid://shopify/ProductVariant/2",
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
  });

  it("rejects malformed product or variant identifiers", () => {
    const result = validateSubscriptionFields({
      email: "buyer@example.com",
      productId: "product-1",
      variantId: "variant-2",
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
  });
});

describe("createBackInStockSubscription", () => {
  const productId = "gid://shopify/Product/11";
  const variantId = "gid://shopify/ProductVariant/22";

  it("creates a valid subscription", async () => {
    const db = createMockDb();
    const result = await createBackInStockSubscription({
      db,
      shop: "demo.myshopify.com",
      email: "buyer@example.com",
      productId,
      variantId,
      admin: createAdmin({ productId, variantId }),
    });

    assert.equal(result.ok, true);
    assert.equal(db.__state.subscriptions.length, 1);
    assert.equal(db.__state.subscriptions[0].email, "buyer@example.com");
    assert.equal(db.__state.subscriptions[0].status, "ACTIVE");
  });

  it("rejects a duplicate active subscription", async () => {
    const db = createMockDb({
      subscriptions: [
        {
          id: "sub_1",
          shop: "demo.myshopify.com",
          email: "buyer@example.com",
          productId,
          variantId,
          status: "ACTIVE",
          notifiedAt: null,
        },
      ],
    });

    const result = await createBackInStockSubscription({
      db,
      shop: "demo.myshopify.com",
      email: "buyer@example.com",
      productId,
      variantId,
      admin: createAdmin({ productId, variantId }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    assert.equal(db.__state.subscriptions.length, 1);
  });

  it("rejects when the variant does not belong to the product", async () => {
    const db = createMockDb();
    const result = await createBackInStockSubscription({
      db,
      shop: "demo.myshopify.com",
      email: "buyer@example.com",
      productId,
      variantId,
      admin: createAdmin({
        productId: "gid://shopify/Product/999",
        variantId,
      }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.equal(db.__state.subscriptions.length, 0);
  });
});
