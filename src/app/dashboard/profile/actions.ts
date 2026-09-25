"use server";

import { randomUUID } from "crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { requireHousehold, requireUserId } from "@/lib/session";
import { signOut } from "@/lib/auth";
import type { ActionState } from "@/lib/actions/auth";
import { toFriendlyError } from "@/lib/actions/errors";
import { sendVerificationEmail } from "@/lib/email";
import { settleDepartingMemberSplits } from "@/lib/settle-departing-member";
import { INVALID_SWISH_NUMBER_ERROR, normalizeSwishNumber } from "@/lib/swish";

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

// GAP-7: the caller's own Swish number, shown as a "Pay with Swish" link to
// household members who owe them money. Only ever the signed-in user's own
// row (userId from the session, never the form), so nobody can set another
// member's number. A blank field clears it. No password gate, unlike the
// email change below: this isn't a login identifier, and the worst a
// hijacked session could do is point Swish at a wrong number — which the
// payer still sees in the Swish app before confirming, since the link
// pre-fills a payment rather than sending one.
export async function updateSwishNumberAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { userId } = await requireHousehold();

  const raw = formData.get("swishNumber");
  const input = typeof raw === "string" ? raw.trim() : "";
  let swishNumber: string | null = null;
  if (input !== "") {
    swishNumber = normalizeSwishNumber(input);
    if (!swishNumber) return { error: INVALID_SWISH_NUMBER_ERROR };
  }

  try {
    await prisma.user.update({ where: { id: userId }, data: { swishNumber } });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/profile");
  // The balances card on the Budget page is the one place others see it.
  revalidatePath("/dashboard/budget");
  return {};
}

// Email is the login identifier, so an unverified swap would be a real
// security regression — anyone with a hijacked/left-open session could lock
// the real owner out just by typing a new address. Requiring the *current
// password* is the minimum real gate: it re-proves the caller is the
// account owner, not just holding a valid session, before the identifier
// changes. On top of that, the new address is marked unverified and sent a
// fresh verification link below — the same EmailVerificationToken flow
// signupAction (src/lib/actions/auth.ts) uses — so a swap to an address the
// caller doesn't actually control can't quietly become the account's login
// identifier.
const updateEmailSchema = z.object({
  newEmail: z.string().trim().toLowerCase().email("Enter a valid email").max(254, "Email is too long"),
  // No .max() here: this only ever gets bcrypt.compare()'d against an
  // existing hash (never re-hashed), so a pre-existing long password must
  // still be accepted for verification — only a *new* password (below)
  // needs the bcrypt-truncation cap.
  currentPassword: z.string().min(1, "Current password is required"),
});

// Mirrors auth.ts's EMAIL_VERIFICATION_TOKEN_TTL_MS — duplicated locally
// rather than imported so this file doesn't pick up a dependency on
// auth.ts's internals (same reasoning as household.ts's own copy).
const EMAIL_VERIFICATION_TOKEN_TTL_MS = 36 * 60 * 60 * 1000;

// Mirrors auth.ts's/household.ts's identically-motivated absoluteAppUrl —
// duplicated locally for the same "no cross-file dependency" reason as
// EMAIL_VERIFICATION_TOKEN_TTL_MS above.
async function absoluteAppUrl(path: string): Promise<string> {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return `${configured}${path}`;

  const headerList = await headers();
  const host = headerList.get("host") ?? "localhost:3000";
  const proto = host.startsWith("localhost") ? "http" : "https";
  return `${proto}://${host}${path}`;
}

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
    // Resets verification status the same way a brand-new signup starts
    // out: emailVerifiedAt is cleared, so the account is gated the same as
    // any other unverified account until the new address is confirmed (see
    // EmailNotVerifiedSignin in src/lib/auth.ts — this only affects a
    // future sign-in, not the caller's already-live session).
    await prisma.user.update({
      where: { id: userId },
      data: { email: newEmail, emailVerifiedAt: null },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "An account with that email already exists" };
    }
    return toFriendlyError(error);
  }

  // Additive, not a hard dependency — same posture as signupAction's send
  // (src/lib/actions/auth.ts): the email change above already succeeded
  // regardless of whether this send does, and the profile page's
  // "resend verification" control (EmailForm) lets the caller request
  // another one later.
  try {
    // Invalidate any of this user's old unused tokens first, same as
    // resendVerificationEmailAction, so a stale link (e.g. from before a
    // previous email change) stops working once a fresh one is issued.
    await prisma.emailVerificationToken.deleteMany({ where: { userId, usedAt: null } });
    const verificationToken = await prisma.emailVerificationToken.create({
      data: {
        userId,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TOKEN_TTL_MS),
      },
    });
    const verifyUrl = await absoluteAppUrl(`/verify-email/${verificationToken.token}`);
    await sendVerificationEmail({ to: newEmail, verifyUrl, locale: user.locale });
  } catch {
    // Swallowed deliberately — see the comment above this block.
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
    // Revokes every other session for this user (another device, or a
    // stolen cookie) on its next request — SCALE-H, see src/lib/session.ts.
    // This one is signed out just below anyway.
    data: { passwordHash, passwordChangedAt: new Date() },
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

// Per-membership rules (see docs/archive/PRODUCTION_READINESS.md task M for the full
// reasoning):
//  - CONTRIBUTOR: settle their split bills, then remove that HouseholdMember
//    row — identical effect to leaveHouseholdAction (src/lib/actions/
//    household.ts), since the household and its shared data (Transaction,
//    InventoryItem, ...) must survive for the remaining members. Every FK
//    from shared data back to HouseholdMember is `onDelete: SetNull` (e.g.
//    HouseholdTask.assignedToMemberId) except TransactionSplit.householdMemberId
//    and MemberSettlement's two member relations, which cascade — that
//    removes *this member's own* cost-share/payment rows and repayments,
//    never the Transaction itself or another member's split row, so no
//    other member's data is lost outright. But their own split row is where
//    any payment they'd made lived (TransactionSplit.amountPaid), so
//    settleDepartingMemberSplits runs first to carry that forward onto the
//    remaining members' rows — see its doc comment. Confirmed every other
//    `onDelete:` in prisma/schema.prisma touching HouseholdMember/User is
//    accounted for by reading through them.
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
        // Same reasoning as removeMemberAction/leaveHouseholdAction in
        // src/lib/actions/household.ts: this membership's split rows are
        // about to cascade away with it, so settle them first — see
        // settleDepartingMemberSplits's doc comment.
        await settleDepartingMemberSplits(tx, membershipId);
        await tx.householdMember.delete({ where: { id: membershipId } });
      }
      await tx.user.delete({ where: { id: userId } });
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  // Same known gap as updatePasswordAction/task K/L: this ends the current
  // session, but a NextAuth JWT session issued before deletion isn't
  // otherwise invalidated (out of scope here — see docs/archive/PRODUCTION_READINESS.md).
  await signOut({ redirectTo: "/login?deleted=success" });
  return {};
}
