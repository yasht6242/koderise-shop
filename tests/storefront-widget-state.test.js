import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  chooseSelectedVariantId,
  moduleAllowsWidget,
  normalizeModuleStatus,
  resolveWidgetVisibility,
  resolveWidgetVisibilityForModule,
} from "../app/services/storefront-widget-state.js";

const variants = [
  { id: 11, available: true },
  { id: 22, available: false },
  { id: 33, available: false },
];

describe("resolveWidgetVisibility", () => {
  it("shows the form only for an unavailable variant", () => {
    assert.deepEqual(resolveWidgetVisibility(variants, 22), {
      show: true,
      variantId: "22",
    });
  });

  it("hides the form for an available variant", () => {
    assert.deepEqual(resolveWidgetVisibility(variants, 11), {
      show: false,
      variantId: "",
    });
  });

  it("hides the form when the selected variant cannot be determined", () => {
    assert.deepEqual(resolveWidgetVisibility(variants, null), {
      show: false,
      variantId: "",
    });
    assert.deepEqual(resolveWidgetVisibility(variants, ""), {
      show: false,
      variantId: "",
    });
  });

  it("hides the form for an unknown variant id", () => {
    assert.deepEqual(resolveWidgetVisibility(variants, 99), {
      show: false,
      variantId: "",
    });
  });

  it("hides the form when availability is missing", () => {
    assert.deepEqual(resolveWidgetVisibility([{ id: 5 }], 5), {
      show: false,
      variantId: "",
    });
  });
});

describe("chooseSelectedVariantId", () => {
  it("uses the single product-form variant that belongs to this product", () => {
    assert.equal(
      chooseSelectedVariantId({
        formVariantIds: ["22"],
        urlVariantId: "11",
        variants,
      }),
      "22",
    );
  });

  it("does not guess when product forms disagree", () => {
    assert.equal(
      chooseSelectedVariantId({
        formVariantIds: ["22", "33"],
        urlVariantId: "22",
        variants,
      }),
      null,
    );
  });

  it("uses the URL variant when no matching product form is found", () => {
    assert.equal(
      chooseSelectedVariantId({
        formVariantIds: ["999"],
        urlVariantId: "33",
        variants,
      }),
      "33",
    );
  });

  it("uses the only variant when the product has one", () => {
    assert.equal(
      chooseSelectedVariantId({
        formVariantIds: [],
        urlVariantId: null,
        variants: [{ id: 7, available: false }],
      }),
      "7",
    );
  });

  it("returns null when several variants exist and none is selected", () => {
    assert.equal(
      chooseSelectedVariantId({
        formVariantIds: [],
        urlVariantId: null,
        variants,
      }),
      null,
    );
  });
});

describe("module status and widget visibility", () => {
  const enabled = { ok: true, enabled: true };
  const disabled = { ok: true, enabled: false };

  it("shows an unavailable variant when the module is enabled", () => {
    assert.deepEqual(resolveWidgetVisibilityForModule(enabled, variants, 22), {
      show: true,
      variantId: "22",
    });
  });

  it("hides an available variant when the module is enabled", () => {
    assert.deepEqual(resolveWidgetVisibilityForModule(enabled, variants, 11), {
      show: false,
      variantId: "",
    });
  });

  it("hides the widget for either variant state when the module is disabled", () => {
    assert.deepEqual(resolveWidgetVisibilityForModule(disabled, variants, 22), {
      show: false,
      variantId: "",
    });
    assert.deepEqual(resolveWidgetVisibilityForModule(disabled, variants, 11), {
      show: false,
      variantId: "",
    });
  });

  it("hides the widget and blocks submission when status fails or is malformed", () => {
    const failures = [
      normalizeModuleStatus(false, { enabled: true }),
      normalizeModuleStatus(true, null),
      normalizeModuleStatus(true, "enabled"),
      normalizeModuleStatus(true, [{ enabled: true }]),
      normalizeModuleStatus(true, { enabled: "true" }),
      normalizeModuleStatus(true, {}),
    ];

    for (const status of failures) {
      assert.equal(moduleAllowsWidget(status), false);
      assert.deepEqual(resolveWidgetVisibilityForModule(status, variants, 22), {
        show: false,
        variantId: "",
      });
    }
  });

  it("keeps the widget hidden when the selected variant changes while disabled", () => {
    assert.deepEqual(resolveWidgetVisibilityForModule(disabled, variants, 11), {
      show: false,
      variantId: "",
    });
    assert.deepEqual(resolveWidgetVisibilityForModule(disabled, variants, 22), {
      show: false,
      variantId: "",
    });
    assert.deepEqual(resolveWidgetVisibilityForModule(disabled, variants, 33), {
      show: false,
      variantId: "",
    });
  });
});
