/**
 * Keep these functions aligned with app/services/storefront-widget-state.js.
 * Theme app extension scripts cannot import that module.
 */
function chooseSelectedVariantId({
  formVariantIds = [],
  urlVariantId = null,
  variants = [],
} = {}) {
  const known = new Set(variants.map((variant) => String(variant.id)));
  const matched = [
    ...new Set(
      formVariantIds.map((id) => String(id)).filter((id) => known.has(id)),
    ),
  ];

  if (matched.length === 1) {
    return matched[0];
  }

  if (matched.length > 1) {
    return null;
  }

  if (urlVariantId != null && urlVariantId !== "" && known.has(String(urlVariantId))) {
    return String(urlVariantId);
  }

  if (variants.length === 1) {
    return String(variants[0].id);
  }

  return null;
}

function resolveWidgetVisibility(variants, selectedVariantId) {
  if (selectedVariantId == null || selectedVariantId === "") {
    return { show: false, variantId: "" };
  }

  const id = String(selectedVariantId);
  const variant = (variants || []).find((item) => String(item.id) === id);

  if (!variant || variant.available !== false) {
    return { show: false, variantId: "" };
  }

  return { show: true, variantId: id };
}

function normalizeModuleStatus(responseOk, body) {
  const parsed =
    body && typeof body === "object" && !Array.isArray(body) ? body : null;

  return {
    ok: responseOk === true && parsed !== null,
    enabled: parsed?.enabled === true,
  };
}

function moduleAllowsWidget(status) {
  return status?.ok === true && status?.enabled === true;
}

function resolveWidgetVisibilityForModule(
  status,
  variants,
  selectedVariantId,
) {
  if (!moduleAllowsWidget(status)) {
    return { show: false, variantId: "" };
  }

  return resolveWidgetVisibility(variants, selectedVariantId);
}

const moduleStatus = { ok: false, enabled: false };
let moduleStatusRequest = null;

function loadModuleStatus() {
  if (!moduleStatusRequest) {
    moduleStatusRequest = fetch("/apps/back-in-stock")
      .then(async (response) => {
        let body = null;
        try {
          body = await response.json();
        } catch {
          body = null;
        }
        const next = normalizeModuleStatus(response.ok, body);
        moduleStatus.ok = next.ok;
        moduleStatus.enabled = next.enabled;
      })
      .catch(() => {
        moduleStatus.ok = false;
        moduleStatus.enabled = false;
      })
      .finally(() => {
        syncAllWidgets();
      });
  }

  return moduleStatusRequest;
}

function readVariants(widget) {
  const node = widget.querySelector(".back-in-stock-widget__variants");
  if (!node) return [];

  try {
    const parsed = JSON.parse(node.textContent);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readIdFromForm(form) {
  const checked = form.querySelector('input[type="radio"][name="id"]:checked');
  if (checked?.value) return checked.value;

  const select = form.querySelector('select[name="id"]');
  if (select?.value) return select.value;

  const inputs = form.querySelectorAll('input[name="id"]');
  for (const input of inputs) {
    if (input.type === "radio" || input.type === "checkbox") continue;
    if (input.value) return input.value;
  }

  return null;
}

function readFormVariantIds(widget, known) {
  const section = widget.closest(".shopify-section, section");
  const productRoot = widget.closest(
    `[data-product-id="${widget.dataset.productId}"]`,
  );
  const roots = [section, productRoot].filter(Boolean);
  const ids = [];

  for (const root of roots) {
    const forms = root.querySelectorAll('form[action*="/cart/add"]');
    for (const form of forms) {
      const id = readIdFromForm(form);
      if (id && known.has(String(id))) ids.push(String(id));
    }
  }

  return [...new Set(ids)];
}

function syncWidget(widget) {
  const variants = readVariants(widget);
  const known = new Set(variants.map((variant) => String(variant.id)));
  const urlVariantId = new URLSearchParams(window.location.search).get("variant");
  const selectedVariantId = chooseSelectedVariantId({
    formVariantIds: readFormVariantIds(widget, known),
    urlVariantId,
    variants,
  });
  const state = resolveWidgetVisibilityForModule(
    moduleStatus,
    variants,
    selectedVariantId,
  );

  widget.dataset.variantId = state.variantId;
  widget.dataset.eligible = state.show ? "true" : "false";
  widget.style.display = state.show ? "" : "none";
}

function syncAllWidgets() {
  try {
    document.querySelectorAll(".back-in-stock-widget").forEach(syncWidget);
  } catch (error) {
    console.error("Back in Stock variant sync failed:", error);
  }
}

function hookHistoryUpdates() {
  if (window.__backInStockHistoryHooked) return;
  window.__backInStockHistoryHooked = true;

  ["pushState", "replaceState"].forEach((methodName) => {
    const original = history[methodName];
    history[methodName] = function historyHook(...args) {
      const result = original.apply(this, args);
      syncAllWidgets();
      return result;
    };
  });
}

document.addEventListener("submit", async (event) => {
  const form = event.target;

  if (!form.matches?.(".back-in-stock-widget__form")) {
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
    await loadModuleStatus();
    syncWidget(widget);

    if (!moduleAllowsWidget(moduleStatus)) {
      message.textContent =
        "Back in Stock isn't accepting requests right now.";
      return;
    }

    if (widget.dataset.eligible !== "true" || !widget.dataset.variantId) {
      message.textContent =
        "This option is available, so a back-in-stock alert is not needed.";
      return;
    }

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

function startWidget() {
  hookHistoryUpdates();
  syncAllWidgets();
  loadModuleStatus();

  document.addEventListener("change", (event) => {
    if (event.target?.getAttribute?.("name") === "id") {
      syncAllWidgets();
    }
  });

  window.addEventListener("popstate", syncAllWidgets);

  const observer = new MutationObserver((mutations) => {
    const relevant = mutations.some((mutation) =>
      [...mutation.addedNodes, ...mutation.removedNodes].some((node) => {
        if (node.nodeType !== 1) return false;
        return (
          node.matches?.(
            ".back-in-stock-widget, form[action*='/cart/add'], [name='id']",
          ) ||
          node.querySelector?.(
            ".back-in-stock-widget, form[action*='/cart/add'], [name='id']",
          )
        );
      }),
    );

    if (relevant) syncAllWidgets();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startWidget);
} else {
  startWidget();
}
