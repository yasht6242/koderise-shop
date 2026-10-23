import { authenticate } from "../shopify.server";
import { retryFailedNotifications } from "../services/notifications.server";
import { handleAdminNotificationRetry } from "../services/notification-retry-http.server";

export function action({ request }) {
  return handleAdminNotificationRetry({
    request,
    authenticateAdmin: (incomingRequest) =>
      authenticate.admin(incomingRequest),
    runRetry: () => retryFailedNotifications({ limit: 50 }),
  });
}
