"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { AuthError } from "next-auth";
import { prisma } from "@/lib/prisma";
import { signIn, signOut } from "@/lib/auth";
import { toFriendlyError } from "@/lib/actions/errors";

export type ActionState = { error?: string };

// bcrypt silently truncates/ignores any bytes past 72 — without a matching
// max here, two different long passwords sharing the same first 72 bytes
// would hash identically, which is surprising and worth rejecting outright
// rather than letting through.
const PASSWORD_MAX_LENGTH = 72;

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
  email: z.string().trim().max(254, "Enter a valid email"),
  password: z.string().max(PASSWORD_MAX_LENGTH, "Invalid email or password"),
});

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
