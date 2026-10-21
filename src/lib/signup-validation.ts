// UX-59: the signup form checks its own fields before the Server Action runs,
// so a mistake is reported in the page's language, right under the field, and
// the form never submits (a submit that comes back with an error makes React
// reset the form, which clears both password fields). signupAction repeats
// the same rules on the server for a client that skips this, so the minimum
// and maximum here must match its schema.

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;

export type SignupField =
  | "displayName"
  | "householdName"
  | "email"
  | "password"
  | "confirmPassword";

export type SignupFieldErrors = {
  nameRequired: string;
  householdRequired: string;
  emailInvalid: string;
  passwordTooShort: string;
  passwordTooLong: string;
  confirmRequired: string;
  passwordMismatch: string;
};

// Deliberately the same loose shape the browser's type="email" check uses:
// something@something.tld. The server's Zod email check is the strict one.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The first invalid field in form order (so focus goes to the topmost
 * mistake), with its message, or null when everything passes.
 */
export function validateSignupFields(
  values: Partial<Record<SignupField, string>>,
  messages: SignupFieldErrors,
): { field: SignupField; message: string } | null {
  const displayName = (values.displayName ?? "").trim();
  const householdName = (values.householdName ?? "").trim();
  const email = (values.email ?? "").trim();
  const password = values.password ?? "";
  const confirmPassword = values.confirmPassword ?? "";

  if (!displayName) return { field: "displayName", message: messages.nameRequired };
  if (!householdName) return { field: "householdName", message: messages.householdRequired };
  if (!EMAIL_PATTERN.test(email)) return { field: "email", message: messages.emailInvalid };
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { field: "password", message: messages.passwordTooShort };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return { field: "password", message: messages.passwordTooLong };
  }
  if (!confirmPassword) return { field: "confirmPassword", message: messages.confirmRequired };
  if (password !== confirmPassword) {
    return { field: "confirmPassword", message: messages.passwordMismatch };
  }
  return null;
}
