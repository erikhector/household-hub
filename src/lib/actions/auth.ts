"use server";

import { randomUUID } from "crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { AuthError } from "next-auth";
import { prisma } from "@/lib/prisma";
import { signIn, signOut } from "@/lib/auth";
import { sendPasswordResetEmail } from "@/lib/email";
import { toFriendlyError } from "@/lib/actions/errors";
import { checkRateLimit } from "@/lib/rate-limit";

export type ActionState = { error?: string };

// bcrypt silently truncates/ignores any bytes past 72 — without a matching
// max here, two different long passwords sharing the same first 72 bytes
// would hash identically, which is surprising and worth rejecting outright
// rather than letting through.
const PASSWORD_MAX_LENGTH = 72;

// Throttles automated account-creation / email-enumeration probing (this
// action's "An account with that email already exists" response confirms
// whether an email is registered) — same reasoning as LOGIN_RATE_LIMIT
// above, just a wider window since a real user only ever needs this once.
const SIGNUP_RATE_LIMIT = 5;
const SIGNUP_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

const signupSchema = z.object({
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
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().max(254, "Enter a valid email"),
  password: z.string().max(PASSWORD_MAX_LENGTH, "Invalid email or password"),
});

// No account lockout (that would let anyone lock a stranger out just by
// typing their email + wrong passwords) — instead this throttles how many
// credential guesses any single email address can absorb per window,
// regardless of source IP. Bcrypt's own cost factor already slows a single
// guess down; this bounds how many guesses get that far at all. See
// src/lib/rate-limit.ts for why this is a speed bump, not a hard guarantee.
const LOGIN_RATE_LIMIT = 10;
const LOGIN_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

// A reset link grants full account takeover to whoever holds it — a much
// higher-value target than a household invite (Invitation's 7-day expiry),
// so this window is short. An hour is generous for a legitimate user (reset
// emails typically arrive within seconds) while keeping a leaked/
// intercepted link's usable window small. See PasswordResetToken's schema
// comment for the same reasoning.
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

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
// LOGIN_RATE_LIMIT's comment). Keyed per-token rather than per-email since
// the caller isn't known to be the token's rightful owner yet.
const RESET_PASSWORD_RATE_LIMIT = 10;
const RESET_PASSWORD_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

const GENERIC_RESET_REQUESTED_MESSAGE =
  "If an account exists for that email, we've sent a password reset link.";

export async function signupAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = signupSchema.safeParse({
    displayName: formData.get("displayName"),
    householdName: formData.get("householdName"),
    email: formData.get("email"),
    password: formData.get("password"),
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
  try {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, passwordHash, displayName },
      });
      const household = await tx.household.create({
        data: { name: householdName },
      });
      await tx.householdMember.create({
        data: { userId: user.id, householdId: household.id, role: "OWNER" },
      });
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  try {
    await signIn("credentials", { email, password, redirectTo: "/dashboard" });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Account created. Please log in." };
    }
    throw error;
  }
  return {};
}

export async function loginAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: "Invalid email or password" };
  }

  if (!(await checkRateLimit(`login:${parsed.data.email}`, LOGIN_RATE_LIMIT, LOGIN_RATE_LIMIT_WINDOW_MS))) {
    return { error: "Too many attempts. Please wait a few minutes and try again." };
  }

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: "/dashboard",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Invalid email or password" };
    }
    throw error;
  }
  return {};
}

export async function logoutAction() {
  await signOut({ redirectTo: "/login" });
}

// Building this from the request's Host/X-Forwarded-Host header would let
// anyone who can shape their own HTTP request (trivial with curl) get this
// app to mail a password-reset link that points at an attacker-controlled
// domain, while the token embedded in it is entirely real — a phishing
// primer disguised as a legitimate reset email. So the base URL must come
// from a value only the deployer controls. Mirrors
// src/lib/actions/household.ts's identically-motivated `absoluteAppUrl` —
// duplicated locally rather than imported so this file (and the sequential
// Wave 2 tasks that follow it — see PRODUCTION_READINESS.md) doesn't pick up
// a dependency on household.ts.
async function absoluteAppUrl(path: string): Promise<string> {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return `${configured}${path}`;

  const headerList = await headers();
  const host = headerList.get("host") ?? "localhost:3000";
  const proto = host.startsWith("localhost") ? "http" : "https";
  return `${proto}://${host}${path}`;
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
      const resetToken = await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          token: randomUUID(),
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      });
      const resetUrl = await absoluteAppUrl(`/reset-password/${resetToken.token}`);
      // Deliberately not awaited-into-the-response: whether this succeeds or
      // fails must never change what the caller sees (see doc comment above).
      await sendPasswordResetEmail({ to: user.email, resetUrl });
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

  const resetToken = await prisma.passwordResetToken.findUnique({ where: { token } });
  if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
    return { error: "This password reset link is invalid or has expired. Request a new one." };
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: resetToken.userId }, data: { passwordHash } });
      await tx.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      });
      // Invalidate any other outstanding reset tokens for this user too —
      // same reasoning as requestPasswordResetAction invalidating old ones
      // up front: a second leaked/older link must stop working once the
      // password has actually changed.
      await tx.passwordResetToken.deleteMany({
        where: { userId: resetToken.userId, usedAt: null, id: { not: resetToken.id } },
      });
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  redirect("/login?reset=success");
}
