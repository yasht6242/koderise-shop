
document.addEventListener("submit", async (event) => {
  const form = event.target;

  if (!form.matches(".back-in-stock-widget__form")) {
    return;
  }

  event.preventDefault();

  const widget = form.closest(".back-in-stock-widget");
  const message = form.querySelector(".back-in-stock-widget__message");
  const button = form.querySelector('button[type="submit"]');
  const email = form.querySelector('input[name="email"]')?.value.trim();

  if (!widget || !message || !button || !email) {
    return;
  }

  message.textContent = "Submitting your request...";
  button.disabled = true;

  try {
    const response = await fetch("/apps/back-in-stock", {
      method: "POST",
      body: new URLSearchParams({
        email,
        productId: `gid://shopify/Product/${widget.dataset.productId}`,
        variantId: `gid://shopify/ProductVariant/${widget.dataset.variantId}`,
      }),
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || "Unable to submit your request.");
    }

    message.textContent = result.message;
  
} catch (error) {
  console.error("Back in Stock submission failed:", error);
  message.textContent =
    error.message || "We couldn't submit your request. Please try again.";
} finally {

    button.disabled = false;
  }
});
