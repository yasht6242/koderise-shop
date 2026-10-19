
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(`
    query GetProductsAndVariants {
      products(first: 20) {
        nodes {
          id
          title
          status
          variants(first: 20) {
            nodes {
              id
              title
              price
              inventoryQuantity
              inventoryItem {
                tracked
              }
            }
          }
        }
      }
    }
  `);

  const result = await response.json();

  if (result.errors) {
    console.error("Shopify GraphQL errors:", result.errors);
    throw new Response("Unable to fetch product variants", {
      status: 500,
    });
  }

  return {
    products: result.data.products.nodes,
  };
};

export default function ProductVariantsPage() {
  const { products } = useLoaderData();

  return (
    <s-page heading="Product Variant Details">
      <s-section heading="Products and their variants">
        <s-paragraph>
          Inventory tracking information from your Shopify development store.
        </s-paragraph>

        {products.length === 0 ? (
          <s-paragraph>No products found.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Product</s-table-header>
              <s-table-header>Variant</s-table-header>
              <s-table-header>Price</s-table-header>
              <s-table-header>Inventory</s-table-header>
              <s-table-header>Tracking</s-table-header>
              <s-table-header>Availability</s-table-header>
            </s-table-header-row>

            <s-table-body>
              {products.flatMap((product) =>
                product.variants.nodes.map((variant) => {
                  const tracked = variant.inventoryItem?.tracked;
                  const quantity = variant.inventoryQuantity;

                  let availability = "Unknown";

                  if (tracked === false) {
                    availability = "Not tracked";
                  } else if (quantity === 0) {
                    availability = "Out of stock";
                  } else if (quantity > 0) {
                    availability = "In stock";
                  }

                  return (
                    <s-table-row key={variant.id}>
                      <s-table-cell>{product.title}</s-table-cell>
                      <s-table-cell>{variant.title}</s-table-cell>
                      <s-table-cell>
                        {variant.price}
                      </s-table-cell>
                      <s-table-cell>
                        {quantity ?? "Unavailable"}
                      </s-table-cell>
                      <s-table-cell>
                        {tracked === true
                          ? "Tracked"
                          : tracked === false
                            ? "Not tracked"
                            : "Unknown"}
                      </s-table-cell>
                      <s-table-cell>{availability}</s-table-cell>
                    </s-table-row>
                  );
                }),
              )}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
