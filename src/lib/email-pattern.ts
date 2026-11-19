// The browser-side "does this look like an email" check the sign-up forms
// share (UX-59, UX-194). Deliberately loose: it only catches a typo before
// the round trip. The server's Zod schemas own the real rule.
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
