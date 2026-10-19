
import { useState } from "react";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  const [savedSubscriptions, response] = await Promise.all([
    db.backInStockSubscription.findMany({
      where: { shop: session.shop },
      orderBy: { createdAt: "desc" },
    }),
    admin.graphql(`
      query GetProductsForSubscriptions {
        products(first: 50, sortKey: TITLE) {
          nodes {
            id
            title
            variants(first: 50) {
              nodes {
                id
                title
                price
              }
            }
          }
        }
      }
    `),
  ]);

  const result = await response.json();

  if (result.errors || !result.data?.products) {
    throw new Response("Unable to load Shopify products.", {
      status: 500,
    });
  }

  const variantLookup = {};

  for (const product of result.data.products.nodes) {
    for (const variant of product.variants.nodes) {
      variantLookup[variant.id] = {
        productTitle: product.title,
        variantTitle: variant.title,
        price: variant.price,
      };
    }
  }

  const subscriptions = savedSubscriptions.map((subscription) => ({
    ...subscription,
    productTitle:
      variantLookup[subscription.variantId]?.productTitle ??
      "Product unavailable",
    variantTitle:
      variantLookup[subscription.variantId]?.variantTitle ??
      "Variant unavailable",
  }));

  return {
    products: result.data.products.nodes,
    subscriptions,
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "create");

  if (intent === "cancel") {
    const subscriptionId = String(
      formData.get("subscriptionId") || "",
    );

    if (!subscriptionId) {
      return {
        success: false,
        message: "Subscription ID is missing.",
      };
    }

    const updated = await db.backInStockSubscription.updateMany({
      where: {
        id: subscriptionId,
        shop: session.shop,
        status: "ACTIVE",
      },
      data: { status: "CANCELLED" },
    });

    if (updated.count === 0) {
      return {
        success: false,
        message: "Subscription was not found or is already cancelled.",
      };
    }

    return {
      success: true,
      message: "Subscription cancelled successfully.",
    };
  }

  const email = String(formData.get("email") || "")
    .trim()
    .toLowerCase();
  const productId = String(formData.get("productId") || "").trim();
  const variantId = String(formData.get("variantId") || "").trim();

  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !productId ||
    !variantId
  ) {
    return {
      success: false,
      message: "Enter a valid email and select a product variant.",
    };
  }

  const response = await admin.graphql(
    `#graphql
      query VerifyVariant($id: ID!) {
        productVariant(id: $id) {
          id
          product {
            id
          }
        }
      }
    `,
    { variables: { id: variantId } },
  );

  const result = await response.json();
  const variant = result.data?.productVariant;

  if (
    result.errors ||
    !variant ||
    variant.product.id !== productId
  ) {
    return {
      success: false,
      message: "The selected product variant could not be verified.",
    };
  }

  const existing = await db.backInStockSubscription.findFirst({
    where: {
      shop: session.shop,
      email,
      variantId,
      status: "ACTIVE",
    },
  });

  if (existing) {
    return {
      success: false,
      message: "This email is already subscribed to this variant.",
    };
  }

  await db.backInStockSubscription.create({
    data: {
      shop: session.shop,
      email,
      productId,
      variantId,
    },
  });

  return {
    success: true,
    message: "Subscription saved successfully.",
  };
};

export default function SubscriptionsPage() {
  const { products, subscriptions } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();

  const [selectedVariant, setSelectedVariant] = useState("");

  const isSubmitting = navigation.state !== "idle";

  const variants = products.flatMap((product) =>
    product.variants.nodes.map((variant) => ({
      productId: product.id,
      variantId: variant.id,
      label: `${product.title} — ${variant.title} — ${variant.price}`,
    })),
  );

  return (
    <s-page heading="Back-in-Stock Subscriptions">
      <s-section heading="Create a subscription">
        <s-paragraph>
          Register a customer email address for a specific product variant.
          Email notifications are not enabled yet.
        </s-paragraph>

        <Form method="post">
          <s-stack direction="block" gap="base">
            <s-email-field
              label="Customer email"
              name="email"
              required
              autocomplete="email"
            />

            <s-select
              label="Product variant"
              name="variantSelection"
              value={selectedVariant}
              required
              onChange={(event) => setSelectedVariant(event.target.value)}
            >
              <s-option value="">Choose a product variant</s-option>

              {variants.map((variant) => (
                <s-option
                  key={variant.variantId}
                  value={variant.variantId}
                >
                  {variant.label}
                </s-option>
              ))}
            </s-select>

            <input
              type="hidden"
              name="variantId"
              value={selectedVariant}
            />

            <input
              type="hidden"
              name="productId"
              value={
                variants.find(
                  (variant) => variant.variantId === selectedVariant,
                )?.productId || ""
              }
            />

            <s-button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : "Save subscription"}
            </s-button>
          </s-stack>
        </Form>
      </s-section>

      {actionData?.message ? (
        <s-section>
          <s-banner
            tone={actionData.success ? "success" : "critical"}
            heading={actionData.success ? "Success" : "Unable to complete"}
          >
            {actionData.message}
          </s-banner>
        </s-section>
      ) : null}

      <s-section heading={`Saved subscriptions (${subscriptions.length})`}>
        {subscriptions.length === 0 ? (
          <s-paragraph>
            No subscriptions yet. Create one using the form above.
          </s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">
                Customer email
              </s-table-header>
              <s-table-header>Product</s-table-header>
              <s-table-header>Variant</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Created</s-table-header>
              <s-table-header>Action</s-table-header>
            </s-table-header-row>

            <s-table-body>
              {subscriptions.map((subscription) => (
                <s-table-row key={subscription.id}>
                  <s-table-cell>{subscription.email}</s-table-cell>
                  <s-table-cell>{subscription.productTitle}</s-table-cell>
                  <s-table-cell>{subscription.variantTitle}</s-table-cell>
                  <s-table-cell>{subscription.status}</s-table-cell>
                  <s-table-cell>
                    {new Date(subscription.createdAt).toLocaleString()}
                  </s-table-cell>
                  <s-table-cell>
                    {subscription.status === "ACTIVE" ? (
                      <Form method="post">
                        <input
                          type="hidden"
                          name="intent"
                          value="cancel"
                        />
                        <input
                          type="hidden"
                          name="subscriptionId"
                          value={subscription.id}
                        />
                        <s-button
                          type="submit"
                          variant="secondary"
                          disabled={isSubmitting}
                        >
                          Cancel
                        </s-button>
                      </Form>
                    ) : (
                      "—"
                    )}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
