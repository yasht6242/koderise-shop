
import { authenticate } from "../shopify.server";
import { retryFailedNotifications } from "../services/notifications.server";

export async function action({ request }) {
  try {
    await authenticate.admin(request);

    const result = await retryFailedNotifications({ limit: 50 });

    return Response.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("Notification retry route failed:", error);

    return Response.json(
      { success: false, error: "Unable to process notification retries." },
      { status: 500 },
    );
  }
}
