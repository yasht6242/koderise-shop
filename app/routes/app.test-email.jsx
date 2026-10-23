import { authenticate } from "../shopify.server";
import { sendBackInStockEmail } from "../services/email.server";

export async function loader({ request }) {
  await authenticate.admin(request);

  return new Response(
    "Email test route. Use the POST method to send a test email.",
    { status: 200 },
  );
}

export async function action({ request }) {
  try {
    await authenticate.admin(request);

    const result = await sendBackInStockEmail({
      to: "delivered@resend.dev",
      productTitle: "Test Product",
      productUrl: "https://example.com",
    });

    return Response.json({ success: true, result });
  } catch (error) {
    console.error("Test email failed:", {
      message: error.message,
    });

    return Response.json(
      { success: false, error: "Unable to send test email." },
      { status: 500 },
    );
  }
}
