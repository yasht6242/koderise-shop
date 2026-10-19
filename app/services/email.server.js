
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return entities[char];
  });
}

export async function sendBackInStockEmail({
  to,
  productTitle,
  productUrl,
}) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not configured.");
  }

  if (!process.env.RESEND_FROM_EMAIL) {
    throw new Error("RESEND_FROM_EMAIL is not configured.");
  }

  const safeTitle = escapeHtml(productTitle || "Your requested item");
  const safeUrl = escapeHtml(productUrl);

  const { data, error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL,
    to,
    subject: `${productTitle || "Your item"} is back in stock!`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6;">
        <h2>Good news! It's back in stock.</h2>
        <p>${safeTitle} is available again.</p>
        <p>
          <a href="${safeUrl}"
             style="display:inline-block;padding:12px 20px;
                    background:#008060;color:#ffffff;
                    text-decoration:none;border-radius:6px;">
            View product
          </a>
        </p>
      </div>
    `,
  });

  if (error) {
    throw new Error(`Resend email failed: ${error.message}`);
  }

  return data;
}
