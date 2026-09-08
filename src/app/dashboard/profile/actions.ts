"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireHousehold, requireUserId } from "@/lib/session";
import { signOut } from "@/lib/auth";
import type { ActionState } from "@/lib/actions/auth";
import { toFriendlyError } from "@/lib/actions/errors";

// Mirrors auth.ts's PASSWORD_MAX_LENGTH — bcrypt silently ignores bytes past
// 72, so anything longer is rejected rather than accepted-but-misleading.
const PASSWORD_MAX_LENGTH = 72;

const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1, "Name is required").max(60, "Name is too long"),
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

  try {
    await prisma.user.update({
      where: { id: userId },
      data: { displayName: parsed.data.displayName },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

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
  newEmail: z.string().trim().toLowerCase().email("Enter a valid email").max(254, "Email is too long"),
  // No .max() here: this only ever gets bcrypt.compare()'d against an
  // existing hash (never re-hashed), so a pre-existing long password must
  // still be accepted for verification — only a *new* password (below)
  // needs the bcrypt-truncation cap.
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

  try {
    await prisma.user.update({
      where: { id: userId },
      data: { email: newEmail },
    });
  } catch {
    return { error: "An account with that email already exists" };
  }

  revalidatePath("/dashboard/profile");
  return {};
}

const updatePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
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

// Account deletion is irreversible and destroys data other household
// members may also rely on, so it requires the same re-authentication gate
// as updateEmailAction/updatePasswordAction above: proving current
// possession of the password, not just a valid session.
const deleteAccountSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
});

// Per-membership rules (see PRODUCTION_READINESS.md task M for the full
// reasoning):
//  - CONTRIBUTOR: just remove that HouseholdMember row — identical effect
//    to leaveHouseholdAction (src/lib/actions/household.ts), since the
//    household and its shared data (Transaction, InventoryItem, ...) must
//    survive for the remaining members. Every FK from shared data back to
//    HouseholdMember is `onDelete: SetNull` (e.g. Transaction.paidByMemberId)
//    except TransactionSplit.householdMemberId, which cascades — but that
//    only removes *this member's own* cost-share row from a split, never the
//    Transaction itself or another member's split row, so no other member's
//    data is lost. Confirmed by reading every `onDelete:` in
//    prisma/schema.prisma touching HouseholdMember/User.
//  - OWNER of a household where they're the only member: delete the whole
//    household too (Household's Cascade relations take care of every
//    household-scoped table), same as deleteHouseholdAction but targeting a
//    specific household id rather than only "the active one".
//  - OWNER with other members present: blocked entirely. Auto-picking a new
//    owner is a human decision, not something this action should guess at —
//    the caller must transferOwnershipAction first (see the household
//    settings page).
export async function deleteAccountAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = await requireUserId();

  const parsed = deleteAccountSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const validPassword = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
  if (!validPassword) {
    return { error: "Current password is incorrect" };
  }

  const memberships = await prisma.householdMember.findMany({
    where: { userId },
    include: { household: { include: { members: true } } },
  });

  const soleOwnerHouseholdIds: string[] = [];
  const contributorMembershipIds: string[] = [];
  const blockedHouseholdNames: string[] = [];

  for (const membership of memberships) {
    if (membership.role === "OWNER") {
      if (membership.household.members.length === 1) {
        soleOwnerHouseholdIds.push(membership.householdId);
      } else {
        blockedHouseholdNames.push(membership.household.name);
      }
    } else {
      contributorMembershipIds.push(membership.id);
    }
  }

  if (blockedHouseholdNames.length > 0) {
    return {
      error:
        `You're the owner of ${blockedHouseholdNames.join(", ")}, which has other members. ` +
        "Transfer ownership to another member from that household's settings before you can delete your account.",
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      for (const householdId of soleOwnerHouseholdIds) {
        await tx.household.delete({ where: { id: householdId } });
      }
      for (const membershipId of contributorMembershipIds) {
        await tx.householdMember.delete({ where: { id: membershipId } });
      }
      await tx.user.delete({ where: { id: userId } });
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  // Same known gap as updatePasswordAction/task K/L: this ends the current
  // session, but a NextAuth JWT session issued before deletion isn't
  // otherwise invalidated (out of scope here — see PRODUCTION_READINESS.md).
  await signOut({ redirectTo: "/login?deleted=success" });
  return {};
}
