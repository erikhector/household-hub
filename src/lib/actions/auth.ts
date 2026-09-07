"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { AuthError } from "next-auth";
import { prisma } from "@/lib/prisma";
import { signIn, signOut } from "@/lib/auth";
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

  if (!checkRateLimit(`signup:${email}`, SIGNUP_RATE_LIMIT, SIGNUP_RATE_LIMIT_WINDOW_MS)) {
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

  if (!checkRateLimit(`login:${parsed.data.email}`, LOGIN_RATE_LIMIT, LOGIN_RATE_LIMIT_WINDOW_MS)) {
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
