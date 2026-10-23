import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [
    activeSubscriptions,
    pendingNotifications,
    failedNotifications,
    sentNotifications,
  ] = await Promise.all([
    db.backInStockSubscription.count({
      where: { shop, status: "ACTIVE" },
    }),
    db.backInStockNotification.count({
      where: { shop, status: "PENDING" },
    }),
    db.backInStockNotification.count({
      where: { shop, status: "FAILED" },
    }),
    db.backInStockNotification.count({
      where: { shop, status: "SENT" },
    }),
  ]);

  return {
    activeSubscriptions,
    pendingNotifications,
    failedNotifications,
    sentNotifications,
  };
};

export default function Index() {
  const {
    activeSubscriptions,
    pendingNotifications,
    failedNotifications,
    sentNotifications,
  } = useLoaderData();
  const retryFetcher = useFetcher();

  return (
    <s-page heading="Back in stock">
      <s-section heading="Overview">
        <s-paragraph>
          Active subscriptions: {activeSubscriptions}
        </s-paragraph>
        <s-paragraph>
          Notifications waiting to send: {pendingNotifications}
        </s-paragraph>
        <s-paragraph>
          Notifications that failed: {failedNotifications}
        </s-paragraph>
        <s-paragraph>Notifications sent: {sentNotifications}</s-paragraph>
        <s-link href="/app/subscriptions">Manage subscriptions</s-link>
      </s-section>

      <s-section heading="Back-in-stock notification retries">
        <s-paragraph>
          Run the retry worker for eligible failed or interrupted notifications.
          Notifications already marked SENT are not retried.
        </s-paragraph>
        <s-stack direction="inline" gap="base">
          <s-button
            onClick={() =>
              retryFetcher.submit({}, {
                method: "POST",
                action: "/app/retry-notifications",
              })
            }
            {...(["loading", "submitting"].includes(retryFetcher.state)
              ? { loading: true }
              : {})}
          >
            Run notification retries
          </s-button>
        </s-stack>
        {retryFetcher.data && (
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <pre
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              <code>{JSON.stringify(retryFetcher.data, null, 2)}</code>
            </pre>
          </s-box>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
