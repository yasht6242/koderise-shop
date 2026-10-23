import { getSubscriptionCreateBlock } from "./shop-settings.server.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PRODUCT_GID_PATTERN = /^gid:\/\/shopify\/Product\/\d+$/;
const VARIANT_GID_PATTERN = /^gid:\/\/shopify\/ProductVariant\/\d+$/;

export function normalizeSubscriptionFields({ email, productId, variantId }) {
  return {
    email: String(email || "")
      .trim()
      .toLowerCase(),
    productId: String(productId || "").trim(),
    variantId: String(variantId || "").trim(),
  };
}

export function validateSubscriptionFields({ email, productId, variantId }) {
  if (
    !EMAIL_PATTERN.test(email) ||
    !PRODUCT_GID_PATTERN.test(productId) ||
    !VARIANT_GID_PATTERN.test(variantId)
  ) {
    return {
      ok: false,
      status: 400,
      error: "Please provide a valid email and product variant.",
    };
  }

  return { ok: true };
}

/**
 * Validates input, confirms the variant belongs to the product, and creates
 * an ACTIVE subscription when one does not already exist.
 *
 * @param {object} params
 * @param {import("@prisma/client").PrismaClient} params.db
 * @param {string} params.shop
 * @param {string} params.email
 * @param {string} params.productId
 * @param {string} params.variantId
 * @param {{ graphql: Function }} params.admin
 */
export async function createBackInStockSubscription({
  db,
  shop,
  email,
  productId,
  variantId,
  admin,
}) {
  const fields = normalizeSubscriptionFields({ email, productId, variantId });
  const validation = validateSubscriptionFields(fields);

  if (!validation.ok) {
    return validation;
  }

  const block = await getSubscriptionCreateBlock(db, shop);
  if (block.blocked) {
    return {
      ok: false,
      status: block.status,
      error: block.error,
    };
  }

  const graphqlResponse = await admin.graphql(
    `#graphql
      query ValidateBackInStockVariant($id: ID!) {
        productVariant(id: $id) {
          id
          product {
            id
          }
        }
      }
    `,
    { variables: { id: fields.variantId } },
  );

  const graphqlResult = await graphqlResponse.json();
  const variant = graphqlResult.data?.productVariant;

  if (
    graphqlResult.errors?.length ||
    !variant ||
    variant.product.id !== fields.productId
  ) {
    return {
      ok: false,
      status: 400,
      error: "The selected product variant could not be verified.",
    };
  }

  const existing = await db.backInStockSubscription.findFirst({
    where: {
      shop,
      email: fields.email,
      variantId: fields.variantId,
      status: "ACTIVE",
    },
  });

  if (existing) {
    return {
      ok: false,
      status: 409,
      error: "You're already subscribed for this item.",
    };
  }

  const subscription = await db.backInStockSubscription.create({
    data: {
      shop,
      email: fields.email,
      productId: fields.productId,
      variantId: fields.variantId,
      status: "ACTIVE",
    },
  });

  return {
    ok: true,
    status: 200,
    message:
      "You're subscribed! We'll notify you when this item is back in stock.",
    subscription,
  };
}
