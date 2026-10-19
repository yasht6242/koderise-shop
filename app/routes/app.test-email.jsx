
import { sendBackInStockEmail } from "../services/email.server";

export async function loader() {
  return new Response(
    "Email test route. Use the POST method to send a test email.",
    { status: 200 },
  );
}

export async function action() {
  try {
    const result = await sendBackInStockEmail({
      to: "delivered@resend.dev",
      productTitle: "Test Product",
      productUrl: "https://example.com",
    });

    return Response.json({ success: true, result });
  } catch (error) {
    console.error("Test email failed:", error);

    return Response.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }
}
