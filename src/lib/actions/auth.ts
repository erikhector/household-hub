"use server";

import { randomUUID } from "crypto";
import { absoluteAppUrl } from "@/lib/app-url";
import { redirect } from "next/navigation";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { AuthError } from "next-auth";
import { prisma } from "@/lib/prisma";
import { signIn, signOut, EmailNotVerifiedSignin, RateLimitedSignin } from "@/lib/auth";
import { sendPasswordResetEmail, sendVerificationEmail } from "@/lib/email";
import { toFriendlyError } from "@/lib/actions/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireUserId } from "@/lib/session";
import { getLocale } from "@/lib/i18n/get-dictionary";
import { logger } from "@/lib/logger";
import { hashToken } from "@/lib/token-hash";

export type ActionState = {
  error?: string;
  /** Set by the create-transaction actions (UX-109), so the "Added … · Undo"
   * toast can delete exactly the row it announced. */
  createdId?: string;
};

// bcrypt silently truncates/ignores any bytes past 72 — without a matching
// max here, two different long passwords sharing the same first 72 bytes
// would hash identically, which is surprising and worth rejecting outright
// rather than letting through.
const PASSWORD_MAX_LENGTH = 72;

// Throttles automated account-creation / email-enumeration probing (this
// action's "An account with that email already exists" response confirms
// whether an email is registered) — same reasoning as LOGIN_RATE_LIMIT in
// src/lib/auth.ts, just a wider window since a real user only ever needs
// this once.
const SIGNUP_RATE_LIMIT = 5;
const SIGNUP_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

const signupSchema = z
  .object({
    displayName: z.string().trim().min(1, "Name is required").max(60, "Name is too long"),
    householdName: z
      .string()
      .trim()
      .min(1, "Household name is required")
      .max(60, "Household name is too long"),
    email: z.string().trim().toLowerCase().email("Enter a valid email").max(254, "Email is too long"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(PASSWORD_MAX_LENGTH, `Password must be ${PASSWORD_MAX_LENGTH} characters or fewer`),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().max(254, "Enter a valid email"),
  password: z.string().max(PASSWORD_MAX_LENGTH, "Invalid email or password"),
});

// The login throttle itself (LOGIN_RATE_LIMIT) lives in src/lib/auth.ts's
// `authorize`, not here — see the "Login rate limiting" section of
// REQUIREMENTS.md (SEC-1) for why: Auth.js also accepts
// `POST /api/auth/callback/credentials` directly, which calls `authorize`
// without ever going through loginAction below, so checking only here left
// that endpoint unthrottled. loginAction has no pre-check of its own
// (that would double-count a single sign-in attempt against the same
// bucket `authorize` already consumes) — it just maps the RateLimitedSignin
// that `authorize` throws to this action's own "too many attempts" copy,
// same pattern as EmailNotVerifiedSignin below.

// A reset link grants full account takeover to whoever holds it — a much
// higher-value target than a household invite (Invitation's 7-day expiry),
// so this window is short. An hour is generous for a legitimate user (reset
// emails typically arrive within seconds) while keeping a leaked/
// intercepted link's usable window small. See PasswordResetToken's schema
// comment for the same reasoning.
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

// Holding this token lets someone mark an email address verified — not an
// account takeover (unlike RESET_TOKEN_TTL_MS above), so it can afford to
// live much longer. 36 hours splits the difference between
// PasswordResetToken's 1 hour and Invitation's 7 days: generous enough to
// cover someone who signs up before bed and verifies the next day, without
// leaving a link usable for the better part of a week. See
// EmailVerificationToken's schema comment for the same reasoning.
const EMAIL_VERIFICATION_TOKEN_TTL_MS = 36 * 60 * 60 * 1000;

// Unauthenticated and, unlike signup/login, requires no knowledge to
// trigger beyond a target's email address — without a limit, this could be
// used to spam a stranger's inbox with reset emails. Wider window / lower
// count than SIGNUP_RATE_LIMIT since a legitimate user only ever needs a
// couple of these per incident (e.g. one now, one retry if the email is
// slow), not the "several signup attempts while fixing typos" case signup
// throttling budgets for.
const REQUEST_RESET_RATE_LIMIT = 3;
const REQUEST_RESET_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

// Throttles guessing at another user's reset token (128-bit UUIDs make
// brute force infeasible either way, but this keeps consistent with the
// rest of this file's "never rely on one layer alone" posture — see
// LOGIN_RATE_LIMIT's comment in src/lib/auth.ts). Keyed per-token rather
// than per-email since the caller isn't known to be the token's rightful
// owner yet.
const RESET_PASSWORD_RATE_LIMIT = 10;
const RESET_PASSWORD_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

// Throttles guessing at another user's verification token. Lower stakes
// than RESET_PASSWORD_RATE_LIMIT (a correct guess only marks an email
// verified) but kept for the same defense-in-depth reason — never rely on
// token entropy alone. Keyed per-token, same as resetPasswordAction.
const VERIFY_EMAIL_RATE_LIMIT = 10;
const VERIFY_EMAIL_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

// Unauthenticated-adjacent (only reachable by an already-signed-in user, via
// the dashboard banner) but still throttled per-user so a compromised or
// buggy client can't be used to spam a mailbox with verification emails.
// Same width/count as REQUEST_RESET_RATE_LIMIT: a legitimate user only ever
// needs a couple of these (one now, one retry if the first didn't arrive).
const RESEND_VERIFICATION_RATE_LIMIT = 3;
const RESEND_VERIFICATION_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

// Unlike resendVerificationEmailAction above, this is reachable while
// signed out (from the login page, once loginAction reports an unverified
// account — see EmailNotVerifiedSignin) — same enumeration exposure as
// requestPasswordResetAction, so it gets the same generic
// always-the-same-response treatment and the same rate-limit shape, keyed
// per-email since there's no session to key on yet.
const RESEND_VERIFICATION_FOR_LOGIN_RATE_LIMIT = 3;
const RESEND_VERIFICATION_FOR_LOGIN_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

const GENERIC_RESET_REQUESTED_MESSAGE =
  "If an account exists for that email, we've sent a password reset link.";

const GENERIC_VERIFICATION_RESENT_MESSAGE =
  "If that account needs verifying, we've sent a fresh verification link. Check your inbox.";

const UNVERIFIED_LOGIN_MESSAGE =
  "Please verify your email before signing in. Check your inbox for the link, or resend it below.";

export type SignupState = {
  error?: string;
  status?: "verification-sent";
  email?: string;
  // Join-via-invite only: the household the new account was added to, so
  // the confirmation can name it (UX-55).
  householdName?: string;
  // Set when the account was created but the verification email itself
  // didn't go out (send failure or an exception creating its token) — see
  // the comment on the try/catch below. Lets the confirmation screen tell
  // the user honestly instead of claiming a link is on its way when it
  // isn't (see A1 in docs/archive/UX_AUDIT_IMPLEMENTATION_PLAN.md).
  emailError?: boolean;
};

export async function signupAction(
  _prevState: SignupState,
  formData: FormData,
): Promise<SignupState> {
  const parsed = signupSchema.safeParse({
    displayName: formData.get("displayName"),
    householdName: formData.get("householdName"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { displayName, householdName, email, password } = parsed.data;

  if (!(await checkRateLimit(`signup:${email}`, SIGNUP_RATE_LIMIT, SIGNUP_RATE_LIMIT_WINDOW_MS))) {
    return { error: "Too many attempts. Please wait a while and try again." };
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { error: "An account with that email already exists" };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  // The language the form was shown in (UX-56): the account locale outranks
  // the cookie once someone signs in, so leaving the DB default (`en`) here
  // would flip a Swedish signup to an English dashboard on first login.
  const locale = await getLocale();
  let userId: string;
  try {
    userId = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, passwordHash, displayName, locale },
      });
      const household = await tx.household.create({
        data: { name: householdName },
      });
      await tx.householdMember.create({
        data: { userId: user.id, householdId: household.id, role: "OWNER" },
      });
      return user.id;
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  // Additive, not a hard dependency — same posture as household invites
  // (see sendHouseholdInviteEmail): the account already exists regardless
  // of whether this send succeeds, and resendVerificationEmailForLoginAction
  // lets the user request a new link later from the login page. Unlike that
  // enumeration-safe path, though, the caller here already knows this email
  // is theirs (they just typed it into this very form), so there's no
  // enumeration risk in telling them plainly when the send didn't go out —
  // see A1 in docs/archive/UX_AUDIT_IMPLEMENTATION_PLAN.md.
  let emailError = false;
  try {
    const rawToken = randomUUID();
    await prisma.emailVerificationToken.create({
      data: {
        userId,
        token: hashToken(rawToken),
        expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TOKEN_TTL_MS),
      },
    });
    const verifyUrl = await absoluteAppUrl(`/verify-email/${rawToken}`);
    // `locale` was resolved above (pre-auth cookie) and stored on the new
    // account, so this email matches what later ones will use.
    const { error } = await sendVerificationEmail({ to: email, verifyUrl, locale });
    if (error) emailError = true;
  } catch (error) {
    toFriendlyError(error);
    emailError = true;
  }

  // No auto sign-in: the account's email must be verified before its first
  // successful sign-in (see EmailNotVerifiedSignin in src/lib/auth.ts, which
  // loginAction below relies on). Signing the user in here would hand out a
  // working session before that check ever ran.
  return { status: "verification-sent", email, ...(emailError ? { emailError: true } : {}) };
}

export type LoginState = { error?: string; unverifiedEmail?: string };

const DEFAULT_POST_LOGIN_PATH = "/dashboard";

// A deep link followed while logged out (e.g. proxy.ts redirecting a
// protected page to /login?next=..., or the join page's "log in" link
// carrying its invite forward — see A5/A8 in docs/archive/UX_AUDIT_IMPLEMENTATION_PLAN.md)
// must only ever send the browser back to a path on this same app, never to
// an attacker-supplied external origin — "next" is trivially caller-set
// (it's a query param), so treat it the same as absoluteAppUrl's Host-header
// distrust above: only a same-origin, root-relative path is honored.
function sanitizeNextPath(value: FormDataEntryValue | null): string {
  if (typeof value !== "string" || value === "") return DEFAULT_POST_LOGIN_PATH;
  // "/x" is fine; "//evil.com" and "/\evil.com" are protocol-relative
  // (browsers treat a leading "//" or "/\" as "same scheme, different
  // host"), and anything containing "://" is an absolute URL outright.
  if (!value.startsWith("/") || /^\/[\\/]/.test(value) || value.includes("://")) {
    return DEFAULT_POST_LOGIN_PATH;
  }
  return value;
}

export async function loginAction(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: "Invalid email or password" };
  }

  const redirectTo = sanitizeNextPath(formData.get("next"));

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo,
    });
  } catch (error) {
    // Checked before the generic AuthError branch below: RateLimitedSignin
    // and EmailNotVerifiedSignin are themselves AuthError subclasses (see
    // src/lib/auth.ts), so the order matters here.
    if (error instanceof RateLimitedSignin) {
      return { error: "Too many attempts. Please wait a few minutes and try again." };
    }
    if (error instanceof EmailNotVerifiedSignin) {
      return { error: UNVERIFIED_LOGIN_MESSAGE, unverifiedEmail: parsed.data.email };
    }
    if (error instanceof AuthError) {
      return { error: "Invalid email or password" };
    }
    throw error;
  }
  return {};
}

// SEC-5: session revocation (SCALE-H) never touched PushSubscription, so
// someone who briefly had the account — a shared computer, a borrowed
// phone — kept receiving household pushes on that device after signing out.
// The endpoint is only known client-side (see src/lib/push-client.ts's
// useLogout, the only caller), so it's optional here and a no-op when
// absent or not a string — no regression for a browser with no active
// subscription, and this is a public Server Action, so a malformed or
// tampered call must degrade to a plain sign-out rather than a 500.
export async function logoutAction(endpoint?: string) {
  if (typeof endpoint === "string" && endpoint) {
    const userId = await requireUserId();
    await prisma.pushSubscription.deleteMany({ where: { endpoint, userId } });
  }
  await signOut({ redirectTo: "/login" });
}


export type RequestPasswordResetState = { error?: string; message?: string };

const requestPasswordResetSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(254, "Email is too long"),
});

/**
 * Never reveals whether `email` belongs to a real account: the same
 * `message` comes back whether or not a user was found, and regardless of
 * whether the email actually sent (see src/lib/email.ts's
 * sendPasswordResetEmail — a delivery failure must never surface as "here's
 * the link instead", unlike the household-invite flow's on-screen
 * fallback). Only validation errors and rate limiting produce a distinct
 * `error` response, since neither of those leaks account existence.
 */
export async function requestPasswordResetAction(
  _prevState: RequestPasswordResetState,
  formData: FormData,
): Promise<RequestPasswordResetState> {
  const parsed = requestPasswordResetSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { email } = parsed.data;

  if (
    !(await checkRateLimit(
      `request-password-reset:${email}`,
      REQUEST_RESET_RATE_LIMIT,
      REQUEST_RESET_RATE_LIMIT_WINDOW_MS,
    ))
  ) {
    return { error: "Too many attempts. Please wait a while and try again." };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    try {
      // Invalidate old unused tokens first so a previously leaked link stops
      // working the moment a new one is requested — deleting rather than
      // just superseding, since a used-up row has no further purpose.
      await prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
      const rawToken = randomUUID();
      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          token: hashToken(rawToken),
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      });
      const resetUrl = await absoluteAppUrl(`/reset-password/${rawToken}`);
      // Deliberately not awaited-into-the-response: whether this succeeds or
      // fails must never change what the caller sees (see doc comment above).
      // The account's own stored locale, not the requester's — this action
      // is reachable from a different browser/device than the account owner
      // normally uses (that's the whole point of a password reset).
      await sendPasswordResetEmail({ to: user.email, resetUrl, locale: user.locale });
    } catch (error) {
      // Swallow: surfacing this would either leak account existence (on a
      // lookup/create failure) or contradict the "never expose delivery
      // failure" rule above. Still logged/reported via toFriendlyError's
      // side effects so it's diagnosable server-side.
      toFriendlyError(error);
    }
  }

  return { message: GENERIC_RESET_REQUESTED_MESSAGE };
}

const resetPasswordSchema = z
  .object({
    token: z.string().min(1, "Invalid or expired reset link"),
    newPassword: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(PASSWORD_MAX_LENGTH, `Password must be ${PASSWORD_MAX_LENGTH} characters or fewer`),
    confirmPassword: z.string().min(1, "Please confirm your new password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export async function resetPasswordAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = resetPasswordSchema.safeParse({
    token: formData.get("token"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { token, newPassword } = parsed.data;

  if (
    !(await checkRateLimit(
      `reset-password:${token}`,
      RESET_PASSWORD_RATE_LIMIT,
      RESET_PASSWORD_RATE_LIMIT_WINDOW_MS,
    ))
  ) {
    return { error: "Too many attempts. Please wait a few minutes and try again." };
  }

  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { token: hashToken(token) },
  });
  if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
    return { error: "This password reset link is invalid or has expired. Request a new one." };
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  try {
    const redeemed = await prisma.$transaction(async (tx) => {
      // SEC-8: claim the token first, atomically. The findUnique above is
      // only a fast pre-check; two concurrent requests can both pass it, but
      // only one updateMany matches `usedAt: null` and flips it.
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: resetToken.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count === 0) return false;
      // passwordChangedAt revokes every session issued before now — the
      // point of a reset is often that someone else has the account (SCALE-H;
      // see src/lib/session.ts).
      await tx.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash, passwordChangedAt: new Date() },
      });
      // Invalidate any other outstanding reset tokens for this user too —
      // same reasoning as requestPasswordResetAction invalidating old ones
      // up front: a second leaked/older link must stop working once the
      // password has actually changed.
      await tx.passwordResetToken.deleteMany({
        where: { userId: resetToken.userId, usedAt: null, id: { not: resetToken.id } },
      });
      // SEC-5: a reset often means someone else had the account — drop every
      // push subscription for this user so they stop receiving household
      // pushes on whatever device(s) they subscribed from.
      await tx.pushSubscription.deleteMany({ where: { userId: resetToken.userId } });
      return true;
    });
    if (!redeemed) {
      return { error: "This password reset link is invalid or has expired. Request a new one." };
    }
  } catch (error) {
    return toFriendlyError(error);
  }

  redirect("/login?reset=success");
}

export type VerifyEmailState = { status?: "verified" | "alreadyVerified"; error?: string };

const verifyEmailSchema = z.object({
  token: z.string().min(1, "This verification link is invalid or has expired. Request a new one."),
});

const INVALID_VERIFICATION_LINK_MESSAGE =
  "This verification link is invalid or has expired. Request a new one.";

/**
 * Idempotent on purpose: a user might click an old verification link twice,
 * or click one after already verifying some other way (e.g. a newer resent
 * link) — both report success (`status: "alreadyVerified"`) rather than an
 * error, since the end state the user cares about (a verified email) is
 * already true. Only a token that doesn't exist, or one for an account
 * that's genuinely still unverified but is used/expired, is an error.
 */
export async function verifyEmailAction(
  _prevState: VerifyEmailState,
  formData: FormData,
): Promise<VerifyEmailState> {
  const parsed = verifyEmailSchema.safeParse({ token: formData.get("token") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { token } = parsed.data;

  if (
    !(await checkRateLimit(
      `verify-email:${token}`,
      VERIFY_EMAIL_RATE_LIMIT,
      VERIFY_EMAIL_RATE_LIMIT_WINDOW_MS,
    ))
  ) {
    return { error: "Too many attempts. Please wait a few minutes and try again." };
  }

  const verificationToken = await prisma.emailVerificationToken.findUnique({
    where: { token: hashToken(token) },
    include: { user: true },
  });
  if (!verificationToken) {
    return { error: INVALID_VERIFICATION_LINK_MESSAGE };
  }

  if (verificationToken.user.emailVerifiedAt) {
    return { status: "alreadyVerified" };
  }

  if (verificationToken.usedAt || verificationToken.expiresAt < new Date()) {
    return { error: INVALID_VERIFICATION_LINK_MESSAGE };
  }

  try {
    const redeemed = await prisma.$transaction(async (tx) => {
      // SEC-8: claim the token atomically (see resetPasswordAction).
      const claimed = await tx.emailVerificationToken.updateMany({
        where: { id: verificationToken.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count === 0) return false;
      await tx.user.update({
        where: { id: verificationToken.userId },
        data: { emailVerifiedAt: new Date() },
      });
      // Same reasoning as resetPasswordAction invalidating other reset
      // tokens on success: an older leaked/unused link for this user should
      // stop working once verification has actually gone through.
      await tx.emailVerificationToken.deleteMany({
        where: {
          userId: verificationToken.userId,
          usedAt: null,
          id: { not: verificationToken.id },
        },
      });
      return true;
    });
    if (!redeemed) return { error: INVALID_VERIFICATION_LINK_MESSAGE };
  } catch (error) {
    return toFriendlyError(error);
  }

  return { status: "verified" };
}

export type ResendVerificationState = { error?: string; sent?: boolean };

/**
 * Only reachable by an already-signed-in user (via the dashboard banner —
 * see src/components/dashboard/email-verification-banner.tsx), so unlike
 * requestPasswordResetAction there's no email-enumeration concern: the
 * caller already knows their own account/email, so distinct error states
 * are fine to surface. Rate-limited per-user rather than per-email since
 * the caller's identity is already known from the session.
 */
export async function resendVerificationEmailAction(
  // Unused, but kept (rather than dropped) so this still matches the
  // (state, payload) => State shape useActionState expects of every action
  // it dispatches — this is the only action in the file with no form
  // fields to read, hence the lone lint suppression.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prevState: ResendVerificationState,
): Promise<ResendVerificationState> {
  const userId = await requireUserId();

  if (
    !(await checkRateLimit(
      `resend-verification:${userId}`,
      RESEND_VERIFICATION_RATE_LIMIT,
      RESEND_VERIFICATION_RATE_LIMIT_WINDOW_MS,
    ))
  ) {
    return { error: "Too many attempts. Please wait a while and try again." };
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  // Both branches below are defensive rather than expected: requireUserId
  // just confirmed a live session, and the banner that triggers this action
  // only renders when emailVerifiedAt is already known to be null.
  if (!user) {
    return { error: "Something went wrong. Please try again." };
  }
  if (user.emailVerifiedAt) {
    return { sent: true };
  }

  try {
    // Invalidate old unused tokens first, same as
    // requestPasswordResetAction, so a stale link stops working once a
    // fresh one is issued.
    await prisma.emailVerificationToken.deleteMany({ where: { userId, usedAt: null } });
    const rawToken = randomUUID();
    await prisma.emailVerificationToken.create({
      data: {
        userId,
        token: hashToken(rawToken),
        expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TOKEN_TTL_MS),
      },
    });
    const verifyUrl = await absoluteAppUrl(`/verify-email/${rawToken}`);
    const { error } = await sendVerificationEmail({ to: user.email, verifyUrl, locale: user.locale });
    if (error) {
      return { error: "Couldn't send the verification email. Please try again later." };
    }
  } catch (error) {
    return toFriendlyError(error);
  }

  return { sent: true };
}

export type ResendVerificationForLoginState = { error?: string; message?: string };

const resendVerificationForLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(254, "Email is too long"),
});

/**
 * The signed-out counterpart to resendVerificationEmailAction above — reached
 * from the login page once loginAction reports an account whose password
 * checked out but whose email isn't verified yet (see EmailNotVerifiedSignin
 * in src/lib/auth.ts). Since the caller here isn't known to own the email
 * the way a signed-in session's owner is, this follows
 * requestPasswordResetAction's enumeration-safe shape instead: the same
 * generic `message` comes back whether or not the account exists, is
 * already verified, or the send itself fails.
 */
export async function resendVerificationEmailForLoginAction(
  _prevState: ResendVerificationForLoginState,
  formData: FormData,
): Promise<ResendVerificationForLoginState> {
  const parsed = resendVerificationForLoginSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { email } = parsed.data;

  if (
    !(await checkRateLimit(
      `resend-verification-login:${email}`,
      RESEND_VERIFICATION_FOR_LOGIN_RATE_LIMIT,
      RESEND_VERIFICATION_FOR_LOGIN_RATE_LIMIT_WINDOW_MS,
    ))
  ) {
    return { error: "Too many attempts. Please wait a while and try again." };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (user && !user.emailVerifiedAt) {
    try {
      await prisma.emailVerificationToken.deleteMany({ where: { userId: user.id, usedAt: null } });
      const rawToken = randomUUID();
      await prisma.emailVerificationToken.create({
        data: {
          userId: user.id,
          token: hashToken(rawToken),
          expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TOKEN_TTL_MS),
        },
      });
      const verifyUrl = await absoluteAppUrl(`/verify-email/${rawToken}`);
      const { error } = await sendVerificationEmail({ to: user.email, verifyUrl, locale: user.locale });
      // Logged, not surfaced: unlike signupAction above, the caller here
      // isn't known to own this email address yet, so this keeps the exact
      // enumeration-safe shape requestPasswordResetAction uses — a distinct
      // response only on a real send failure would let an attacker tell a
      // registered-but-unverified email apart from an unregistered one.
      // Still diagnosable server-side, which "silently swallowed" wasn't.
      if (error) {
        logger.error("Failed to resend verification email", { error });
      }
    } catch (error) {
      // Swallow, same reasoning as requestPasswordResetAction: surfacing
      // this would leak account existence. Still diagnosable server-side
      // via toFriendlyError's side effects.
      toFriendlyError(error);
    }
  }

  return { message: GENERIC_VERIFICATION_RESENT_MESSAGE };
}
