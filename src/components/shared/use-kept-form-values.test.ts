import { describe, expect, it } from "vitest";
import { pickFormValues } from "./use-kept-form-values";

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
