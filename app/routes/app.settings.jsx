import { useEffect, useState } from "react";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  isBackInStockEnabled,
  setBackInStockEnabled,
} from "../services/shop-settings.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  let backInStockEnabled;
  try {
    backInStockEnabled = await isBackInStockEnabled(db, session.shop);
  } catch {
    throw new Response("Unable to load Back in Stock settings.", {
      status: 503,
    });
  }

  return { backInStockEnabled };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const value = String(formData.get("backInStockEnabled") || "");

  if (value !== "true" && value !== "false") {
    return {
      success: false,
      message: "Choose whether Back in Stock is enabled.",
    };
  }

  try {
    await setBackInStockEnabled(db, session.shop, value === "true");
  } catch {
    return {
      success: false,
      message: "The setting could not be saved.",
    };
  }

  return {
    success: true,
    message:
      value === "true"
        ? "Back in Stock is enabled for this shop."
        : "Back in Stock is disabled for this shop.",
  };
};

export default function SettingsPage() {
  const { backInStockEnabled } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const [enabled, setEnabled] = useState(backInStockEnabled ? "true" : "false");
  const isSubmitting = navigation.state !== "idle";

  useEffect(() => {
    setEnabled(backInStockEnabled ? "true" : "false");
  }, [backInStockEnabled]);

  return (
    <s-page heading="Settings">
      <s-section heading="Back in Stock">
        <s-paragraph>
          This switch applies only to the current shop. Turning it off rejects
          new subscriptions from the storefront and from the Subscriptions
          page. Existing subscriptions stay in the list and can still be
          cancelled.
        </s-paragraph>
        <s-paragraph>
          Pending, failed, and interrupted notifications are kept and are not
          sent while the module is off. Turning it back on does not send them
          immediately. Use Run notification retries on the Home page when a job
          is eligible under the existing retry rules. A notification that is
          already being sent may still finish after the module is turned off.
        </s-paragraph>

        <Form method="post">
          <s-stack direction="block" gap="base">
            <s-select
              label="Back in Stock module"
              name="backInStockChoice"
              value={enabled}
              onChange={(event) => setEnabled(event.target.value)}
            >
              <s-option value="true">Enabled</s-option>
              <s-option value="false">Disabled</s-option>
            </s-select>
            <input type="hidden" name="backInStockEnabled" value={enabled} />
            <s-button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : "Save"}
            </s-button>
          </s-stack>
        </Form>
      </s-section>

      {actionData?.message ? (
        <s-section>
          <s-banner
            tone={actionData.success ? "success" : "critical"}
            heading={actionData.success ? "Saved" : "Unable to save"}
          >
            {actionData.message}
          </s-banner>
        </s-section>
      ) : null}

      <s-section heading="Widget text">
        <s-paragraph>
          The heading, description, and button text are set on the Back in
          stock block in the Shopify theme editor. This page does not change
          those words.
        </s-paragraph>
      </s-section>

      <s-section heading="When the widget appears">
        <s-paragraph>
          The widget is shown only when the selected product variant is
          unavailable. An available variant does not show the form.
        </s-paragraph>
      </s-section>

      <s-section heading="Notifications">
        <s-paragraph>
          The app sends one back-in-stock notification for each restock cycle.
          If the item sells out and later comes back in stock, a new
          notification can be sent.
        </s-paragraph>
        <s-paragraph>
          Delivery is not guaranteed. A message can fail or, in rare cases, be
          attempted again if sending is interrupted after the email provider
          accepts it.
        </s-paragraph>
      </s-section>

      <s-section heading="Retries">
        <s-paragraph>
          Use Run notification retries on the Home page to process eligible
          failed or interrupted notifications. Notifications already marked
          sent are not retried. Retries are not automatic until a scheduler is
          configured.
        </s-paragraph>
        <s-link href="/app">Go to Home</s-link>
      </s-section>

      <s-section heading="Email sender">
        <s-paragraph>
          The sender address is configured on the server with the environment
          variable RESEND_FROM_EMAIL. The address is not shown here.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
