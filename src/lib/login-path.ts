/**
 * UX-61: `/login` with the email pre-filled, so the step after verifying an
 * email or resetting a password doesn't start with an empty form. The
 * address rides in the query string (encoded by URLSearchParams); it's the
 * visitor's own, from the link they just redeemed. Without an email it's
 * the plain path.
 */
export function loginPath(email?: string | null, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams(extra);
  if (email) params.set("email", email);
  const query = params.toString();
  return query ? `/login?${query}` : "/login";
}
