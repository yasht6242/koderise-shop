/**
 * Pure Back-in-Stock widget rules.
 * The theme asset extensions/back-in-stock-widget/assets/back-in-stock.js
 * keeps the same rules inline because theme scripts cannot import this module.
 */

export function chooseSelectedVariantId({
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

  // More than one product form reported a different variant. Do not guess.
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

export function resolveWidgetVisibility(variants, selectedVariantId) {
  if (selectedVariantId == null || selectedVariantId === "") {
    return { show: false, variantId: "" };
  }

  const id = String(selectedVariantId);
  const variant = (variants || []).find((item) => String(item.id) === id);

  // Only a variant Shopify marks unavailable is eligible.
  // Available, untracked, and continue-selling variants stay hidden.
  if (!variant || variant.available !== false) {
    return { show: false, variantId: "" };
  }

  return { show: true, variantId: id };
}

/**
 * A status body only counts when it is a JSON object from a successful response.
 * enabled must be the boolean true.
 */
export function normalizeModuleStatus(responseOk, body) {
  const parsed =
    body && typeof body === "object" && !Array.isArray(body) ? body : null;

  return {
    ok: responseOk === true && parsed !== null,
    enabled: parsed?.enabled === true,
  };
}

export function moduleAllowsWidget(status) {
  return status?.ok === true && status?.enabled === true;
}

/**
 * Availability still decides which variant can show.
 * The module status is applied on every call, so a later variant change
 * cannot reveal the widget while the module is off or the status is unusable.
 */
export function resolveWidgetVisibilityForModule(
  moduleStatus,
  variants,
  selectedVariantId,
) {
  if (!moduleAllowsWidget(moduleStatus)) {
    return { show: false, variantId: "" };
  }

  return resolveWidgetVisibility(variants, selectedVariantId);
}
