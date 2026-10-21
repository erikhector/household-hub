import { describe, expect, it } from "vitest";
import { validateSignupFields, type SignupFieldErrors } from "./signup-validation";

const messages: SignupFieldErrors = {
  nameRequired: "name",
  householdRequired: "household",
  emailInvalid: "email",
  passwordTooShort: "short",
  passwordTooLong: "long",
  confirmRequired: "confirm",
  passwordMismatch: "mismatch",
};

const valid = {
  displayName: "Ada",
  householdName: "Home",
  email: "ada@example.com",
  password: "a-long-password",
  confirmPassword: "a-long-password",
};

describe("validateSignupFields", () => {
  it("passes a complete form", () => {
    expect(validateSignupFields(valid, messages)).toBeNull();
  });

  it("flags the first bad field in form order", () => {
    expect(validateSignupFields({ ...valid, displayName: "  ", email: "x" }, messages)).toEqual({
      field: "displayName",
      message: "name",
    });
    expect(validateSignupFields({ ...valid, householdName: "" }, messages)?.field).toBe("householdName");
  });

  it("rejects a malformed email", () => {
    expect(validateSignupFields({ ...valid, email: "ada@example" }, messages)).toEqual({
      field: "email",
      message: "email",
    });
  });

  it("rejects a short and an over-long password", () => {
    expect(validateSignupFields({ ...valid, password: "short", confirmPassword: "short" }, messages)).toEqual({
      field: "password",
      message: "short",
    });
    const tooLong = "x".repeat(73);
    expect(validateSignupFields({ ...valid, password: tooLong, confirmPassword: tooLong }, messages)?.message).toBe(
      "long",
    );
  });

  it("puts a mismatch on Confirm password", () => {
    expect(validateSignupFields({ ...valid, confirmPassword: "different-one" }, messages)).toEqual({
      field: "confirmPassword",
      message: "mismatch",
    });
    expect(validateSignupFields({ ...valid, confirmPassword: "" }, messages)?.message).toBe("confirm");
  });
});
