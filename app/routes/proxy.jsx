import { authenticate } from "../shopify.server";
import db from "../db.server";
import { createBackInStockSubscription } from "../services/subscriptions.server";
import { isBackInStockEnabled } from "../services/shop-settings.server";

export async function loader({ request }) {
  try {
    const { session } = await authenticate.public.appProxy(request);

    if (!session?.shop) {
      return Response.json(
        { success: false, enabled: false, error: "Unable to identify the store." },
        { status: 401 },
      );
    }

    let enabled = false;
    try {
      enabled = await isBackInStockEnabled(db, session.shop);
    } catch {
      enabled = false;
    }

    return Response.json({
      success: true,
      enabled,
      message: "Back in Stock App Proxy is connected.",
    });
  } catch (error) {
    console.error("App Proxy authentication failed:", {
      message: error.message,
    });

    return Response.json(
      { success: false, error: "Unable to authenticate App Proxy request." },
      { status: 401 },
    );
  }
}

export async function action({ request }) {
  try {
    const { session, admin } = await authenticate.public.appProxy(request);

    if (!session?.shop || !admin) {
      return Response.json(
        { success: false, error: "Unable to identify the store." },
        { status: 401 },
      );
    }

    const formData = await request.formData();

    const result = await createBackInStockSubscription({
      db,
      shop: session.shop,
      email: formData.get("email"),
      productId: formData.get("productId"),
      variantId: formData.get("variantId"),
      admin,
    });

    if (!result.ok) {
      return Response.json(
        { success: false, error: result.error },
        { status: result.status },
      );
    }

    return Response.json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    console.error("Back in Stock submission failed:", {
      message: error.message,
    });

    return Response.json(
      {
        success: false,
        error: "We couldn't save your subscription. Please try again.",
      },
      { status: 500 },
    );
  }
}
