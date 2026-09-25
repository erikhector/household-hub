// SCALE-H: revoking JWT sessions when the password changes.
//
// Sessions are stateless JWTs (src/lib/auth.config.ts), so there is no
// server-side session row to delete when a password is reset or changed.
// Instead every token carries `pwdChangedAt` — the user's
// `User.passwordChangedAt` as of sign-in — and the Node-side guards compare
// it with the database on each request. This module holds that comparison
// so src/lib/session.ts (which decides to bounce the request) and
// src/app/session-expired/route.ts (which actually clears the cookie) can
// never disagree about what "revoked" means — if they did, a request could
// ping-pong between the two.
//
// Pure (no Prisma, no auth import) so it's trivially testable and safe to
// import from anywhere.

// Where session.ts sends a revoked session. It can't be /login: proxy.ts
// redirects any request that still carries a session cookie away from
// /login to /dashboard, which would bounce straight back here forever. The
// route handler at this path clears the cookie first, then goes to /login.
export const SESSION_EXPIRED_PATH = "/session-expired";

// Query param /login reads to explain why the user was signed out.
export const SESSION_EXPIRED_LOGIN_PATH = "/login?expired=password";

// `user` is the row as it is now (null if it no longer exists);
// `tokenPwdChangedAt` is the epoch-ms copy stamped into the JWT at sign-in.
export function isSessionRevoked(
  user: { passwordChangedAt: Date | null } | null,
  tokenPwdChangedAt: number | null | undefined
): boolean {
  // A token for a user that has since been deleted can't be valid either.
  // Account deletion signs its own session out, but any other device's
  // cookie would otherwise keep "working" against a missing row.
  if (!user) return true;
  // Null = the password hasn't changed since this column was added, so
  // every token is valid — deploying SCALE-H logs nobody out.
  if (!user.passwordChangedAt) return false;
  // A token issued before SCALE-H has no claim at all, and one issued
  // before the user's first change carries null; both predate the change.
  if (tokenPwdChangedAt == null) return true;
  // Strictly newer: signing in after a change stamps the token with that
  // exact value (Postgres and Date both keep milliseconds), so equal means
  // "issued under the current password".
  return user.passwordChangedAt.getTime() > tokenPwdChangedAt;
}
