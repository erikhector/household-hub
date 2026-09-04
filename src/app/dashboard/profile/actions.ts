"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { signOut } from "@/lib/auth";
import type { ActionState } from "@/lib/actions/auth";

const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1, "Name is required"),
});

export async function updateProfileAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { userId } = await requireHousehold();

  const parsed = updateProfileSchema.safeParse({ displayName: formData.get("displayName") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  await prisma.user.update({
    where: { id: userId },
    data: { displayName: parsed.data.displayName },
  });

  revalidatePath("/dashboard/profile");
  revalidatePath("/dashboard");
  return {};
}

// Email is the login identifier, so an unverified swap would be a real
// security regression — anyone with a hijacked/left-open session could lock
// the real owner out just by typing a new address. This app has no email
// delivery integration yet (see REQUIREMENTS.md — invite links are
// copy/paste only), so a send-a-confirmation-link flow isn't available to
// build on here. Requiring the *current password* is the minimum real gate:
// it re-proves the caller is the account owner, not just holding a valid
// session, before the identifier changes.
const updateEmailSchema = z.object({
  newEmail: z.string().trim().toLowerCase().email("Enter a valid email"),
  currentPassword: z.string().min(1, "Current password is required"),
});

export async function updateEmailAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { userId } = await requireHousehold();

  const parsed = updateEmailSchema.safeParse({
    newEmail: formData.get("newEmail"),
    currentPassword: formData.get("currentPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { newEmail, currentPassword } = parsed.data;

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  const validPassword = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!validPassword) {
    return { error: "Current password is incorrect" };
  }

  if (newEmail === user.email) {
    return { error: "That's already your email" };
  }

  const existing = await prisma.user.findUnique({ where: { email: newEmail } });
  if (existing) {
    return { error: "An account with that email already exists" };
  }

  await prisma.user.update({
    where: { id: userId },
    data: { email: newEmail },
  });

  revalidatePath("/dashboard/profile");
  return {};
}

const updatePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Please confirm your new password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export async function updatePasswordAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { userId } = await requireHousehold();

  const parsed = updatePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { currentPassword, newPassword } = parsed.data;

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  const validPassword = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!validPassword) {
    return { error: "Current password is incorrect" };
  }

  // Reuse the exact hashing approach signup already uses (bcryptjs, cost 12)
  // rather than reinventing it — see src/lib/actions/auth.ts.
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
  });

  // Rotating the password credential should invalidate the current session
  // too, the same way changing a password anywhere else typically forces
  // re-authentication. signOut's redirect propagates out of this action,
  // which useActionState/formAction handles the same way logoutAction does.
  await signOut({ redirectTo: "/login" });
  return {};
}
