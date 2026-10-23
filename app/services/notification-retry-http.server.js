import { createHash, timingSafeEqual } from "node:crypto";
import { retryFailedNotifications } from "./notifications.server.js";

export function readBearerToken(request) {
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match ? match[1] : "";
}

export function bearerTokenMatches(providedToken, expectedSecret) {
  const provided = typeof providedToken === "string" ? providedToken : "";
  const expected = typeof expectedSecret === "string" ? expectedSecret : "";
  const providedHash = createHash("sha256").update(provided, "utf8").digest();
  const expectedHash = createHash("sha256").update(expected, "utf8").digest();
  const hashesMatch = timingSafeEqual(providedHash, expectedHash);

  return expected.length > 0 && hashesMatch;
}

function publicRetryCounts(result) {
  return {
    success: true,
    retried: result?.retried ?? 0,
    sent: result?.sent ?? 0,
    failed: result?.failed ?? 0,
    skipped: result?.skipped ?? 0,
  };
}

export async function handleInternalNotificationRetry({
  request,
  expectedSecret,
  runRetry,
}) {
  if (request.method !== "POST") {
    return Response.json(
      { success: false, error: "Method not allowed." },
      { status: 405 },
    );
  }

  if (!bearerTokenMatches(readBearerToken(request), expectedSecret)) {
    return Response.json(
      { success: false, error: "Unauthorized." },
      { status: 401 },
    );
  }

  try {
    const result = await runRetry();
    return Response.json(publicRetryCounts(result));
  } catch (error) {
    console.error("Scheduled notification retry failed:", {
      message: error?.message,
    });

    return Response.json(
      { success: false, error: "Unable to process notification retries." },
      { status: 500 },
    );
  }
}

export function runScheduledNotificationRetry(request) {
  return handleInternalNotificationRetry({
    request,
    expectedSecret: process.env.NOTIFICATION_RETRY_SECRET,
    runRetry: () => retryFailedNotifications({ limit: 50 }),
  });
}

export async function handleAdminNotificationRetry({
  request,
  authenticateAdmin,
  runRetry,
}) {
  try {
    if (request.method !== "POST") {
      return Response.json(
        { success: false, error: "Method not allowed." },
        { status: 405 },
      );
    }

    await authenticateAdmin(request);
    const result = await runRetry();

    return Response.json(publicRetryCounts(result));
  } catch (error) {
    console.error("Notification retry route failed:", {
      message: error?.message,
    });

    return Response.json(
      { success: false, error: "Unable to process notification retries." },
      { status: 500 },
    );
  }
}
