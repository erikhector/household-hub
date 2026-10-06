import { describe, expect, it } from "vitest";
import { keepOnly, pickFormValues } from "./use-kept-form-values";

describe("keepOnly", () => {
  it("drops every remembered field that isn't listed", () => {
    // "Save & add another": quantity and threshold carry over, the
    // previous item's expiry and use-within don't.
    const submitted = { quantity: "3", lowStockThreshold: "2", expiresAt: "2026-12-01", useWithinDaysOpened: "5" };

    expect(keepOnly(submitted, ["quantity", "lowStockThreshold"])).toEqual({
      quantity: "3",
      lowStockThreshold: "2",
    });
  });

  it("doesn't invent a listed field that was never remembered", () => {
    expect(keepOnly<"quantity" | "expiresAt">({ expiresAt: "" }, ["quantity"])).toEqual({});
  });
});

describe("pickFormValues", () => {
  it("keeps only the listed fields", () => {
    const formData = new FormData();
    formData.set("email", "a@example.com");
    formData.set("displayName", "Ada");
    formData.set("password", "hunter22");

    expect(pickFormValues(formData, ["email", "displayName"])).toEqual({
      email: "a@example.com",
      displayName: "Ada",
    });
  });

  it("keeps an empty string, so a field the user cleared stays cleared", () => {
    const formData = new FormData();
    formData.set("expiresAt", "");

    expect(pickFormValues(formData, ["expiresAt"])).toEqual({ expiresAt: "" });
  });

  it("skips fields that weren't submitted and file fields", () => {
    const formData = new FormData();
    formData.set("photo", new Blob(["x"]), "photo.png");

    expect(pickFormValues(formData, ["photo", "useWithinDaysOpened"])).toEqual({});
  });
});
