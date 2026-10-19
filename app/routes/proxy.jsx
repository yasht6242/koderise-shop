
import { authenticate } from "../shopify.server";
import db from "../db.server";

export async function loader({ request }) {
  try {
    await authenticate.public.appProxy(request);

    return Response.json({
      success: true,
      message: "Back in Stock App Proxy is connected.",
    });
  } catch (error) {
    console.error("App Proxy authentication failed:", error);

    return Response.json(
      { success: false, error: "Unable to authenticate App Proxy request." },
      { status: 401 }
    );
  }
}

export async function action({ request }) {
  try {
    const { session, admin } =
      await authenticate.public.appProxy(request);

    if (!session?.shop || !admin) {
      return Response.json(
        { success: false, error: "Unable to identify the store." },
        { status: 401 }
      );
    }

    const formData = await request.formData();

    const email = String(formData.get("email") || "")
      .trim()
      .toLowerCase();

    const productId = String(formData.get("productId") || "").trim();
    const variantId = String(formData.get("variantId") || "").trim();

    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !/^gid:\/\/shopify\/Product\/\d+$/.test(productId) ||
      !/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(variantId)
    ) {
      return Response.json(
        {
          success: false,
          error: "Please provide a valid email and product variant.",
        },
        { status: 400 }
      );
    }

    // Confirm the variant belongs to the submitted product.
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
      { variables: { id: variantId } }
    );

    const graphqlResult = await graphqlResponse.json();
    const variant = graphqlResult.data?.productVariant;

    if (
      graphqlResult.errors?.length ||
      !variant ||
      variant.product.id !== productId
    ) {
      return Response.json(
        {
          success: false,
          error: "The selected product variant could not be verified.",
        },
        { status: 400 }
      );
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
      return Response.json(
        {
          success: false,
          error: "You're already subscribed for this item.",
        },
        { status: 409 }
      );
    }

    await db.backInStockSubscription.create({
      data: {
        shop: session.shop,
        email,
        productId,
        variantId,
        status: "ACTIVE",
      },
    });

    return Response.json({
      success: true,
      message: "You're subscribed! We'll notify you when this item is back in stock.",
    });
  } catch (error) {
    console.error("Back in Stock submission failed:", error);

    return Response.json(
      {
        success: false,
        error: "We couldn't save your subscription. Please try again.",
      },
      { status: 500 }
    );
  }
}
