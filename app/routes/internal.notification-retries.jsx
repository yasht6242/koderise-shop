import { runScheduledNotificationRetry } from "../services/notification-retry-http.server";

export function loader() {
  return Response.json(
    { success: false, error: "Method not allowed." },
    { status: 405 },
  );
}

export function action({ request }) {
  return runScheduledNotificationRetry(request);
}
