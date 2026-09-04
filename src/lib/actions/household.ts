"use server";

import { randomUUID } from "crypto";
import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { AuthError } from "next-auth";
import { prisma } from "@/lib/prisma";
import { ACTIVE_HOUSEHOLD_COOKIE, requireHousehold } from "@/lib/session";
import { signIn } from "@/lib/auth";
import { sendHouseholdInviteEmail } from "@/lib/email";
import type { ActionState } from "@/lib/actions/auth";

const ACTIVE_HOUSEHOLD_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const INVITE_TTL_DAYS = 7;

export async function createInviteAction(): Promise<{ url?: string; token?: string; error?: string }> {
  const { household } = await requireHousehold();

  const invitation = await prisma.invitation.create({
    data: {
      householdId: household.id,
      token: randomUUID(),
      expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
    },
  });

  revalidatePath("/dashboard/household");
  return { url: `/join/${invitation.token}`, token: invitation.token };
}

async function absoluteAppUrl(path: string): Promise<string> {
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";
  const proto = headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}${path}`;
}

const sendInviteEmailSchema = z.object({
  token: z.string().min(1),
  email: z.string().trim().email("Enter a valid email address"),
});

// Sends the same link the on-screen "copy link" UI already shows for this
// invite (see InviteButton) — email delivery is additive, not a
// replacement, so the invite still works via manual copy/paste if this
// fails or if RESEND_API_KEY isn't configured (see src/lib/email.ts).
export async function sendInviteEmailAction(token: string, email: string): Promise<ActionState> {
  const { household } = await requireHousehold();

  const parsed = sendInviteEmailSchema.safeParse({ token, email });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const invitation = await prisma.invitation.findFirst({
    where: { token: parsed.data.token, householdId: household.id },
  });
  if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) {
    return { error: "This invite link is invalid or has expired" };
  }

  const inviteUrl = await absoluteAppUrl(`/join/${invitation.token}`);
  const result = await sendHouseholdInviteEmail({
    to: parsed.data.email,
    householdName: household.name,
    inviteUrl,
  });

  return result;
}

async function getValidInvitation(token: string) {
  const invitation = await prisma.invitation.findUnique({
    where: { token },
    include: { household: true },
  });
  if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) {
    return null;
  }
  return invitation;
}

export async function getInvitationForDisplay(token: string) {
  const invitation = await getValidInvitation(token);
  if (!invitation) return null;
  return { householdName: invitation.household.name };
}

export async function acceptInviteAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const token = formData.get("token");
  if (typeof token !== "string") return { error: "Invalid invite link" };

  const invitation = await getValidInvitation(token);
  if (!invitation) return { error: "This invite link is invalid or has expired" };

  const { userId } = await requireHousehold();

  const alreadyMember = await prisma.householdMember.findUnique({
    where: { householdId_userId: { householdId: invitation.householdId, userId } },
  });

  if (!alreadyMember) {
    await prisma.$transaction([
      prisma.householdMember.create({
        data: { householdId: invitation.householdId, userId, role: "CONTRIBUTOR" },
      }),
      prisma.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      }),
    ]);
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_HOUSEHOLD_COOKIE, invitation.householdId, {
    maxAge: ACTIVE_HOUSEHOLD_COOKIE_MAX_AGE,
    path: "/",
  });

  redirect("/dashboard");
}

const joinSignupSchema = z.object({
  token: z.string().min(1),
  displayName: z.string().trim().min(1, "Name is required"),
  email: z.string().trim().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export async function joinViaInviteSignupAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = joinSignupSchema.safeParse({
    token: formData.get("token"),
    displayName: formData.get("displayName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { token, displayName, email, password } = parsed.data;

  const invitation = await getValidInvitation(token);
  if (!invitation) return { error: "This invite link is invalid or has expired" };

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { error: "An account with that email already exists. Please log in, then open the invite link again." };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { email, passwordHash, displayName } });
    await tx.householdMember.create({
      data: { householdId: invitation.householdId, userId: user.id, role: "CONTRIBUTOR" },
    });
    await tx.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } });
  });

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_HOUSEHOLD_COOKIE, invitation.householdId, {
    maxAge: ACTIVE_HOUSEHOLD_COOKIE_MAX_AGE,
    path: "/",
  });

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

export async function switchHouseholdAction(householdId: string) {
  const session = await requireHousehold();
  const isMember = session.households.some((h) => h.id === householdId);
  if (!isMember) return;

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_HOUSEHOLD_COOKIE, householdId, {
    maxAge: ACTIVE_HOUSEHOLD_COOKIE_MAX_AGE,
    path: "/",
  });

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

const createHouseholdSchema = z.object({
  name: z.string().trim().min(1, "Household name is required"),
});

export async function createHouseholdAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { userId } = await requireHousehold();

  const parsed = createHouseholdSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const household = await prisma.household.create({
    data: {
      name: parsed.data.name,
      members: { create: { userId, role: "OWNER" } },
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_HOUSEHOLD_COOKIE, household.id, {
    maxAge: ACTIVE_HOUSEHOLD_COOKIE_MAX_AGE,
    path: "/",
  });

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

// --- Owner-only administration -----------------------------------------

export async function removeMemberAction(memberId: string): Promise<ActionState> {
  const { household, role, userId } = await requireHousehold();
  if (role !== "OWNER") {
    return { error: "Only the household owner can remove members" };
  }

  const member = await prisma.householdMember.findFirst({
    where: { id: memberId, householdId: household.id },
  });
  if (!member) return { error: "Member not found" };
  if (member.userId === userId) return { error: "You can't remove yourself" };
  if (member.role === "OWNER") return { error: "The owner can't be removed" };

  await prisma.householdMember.delete({ where: { id: member.id } });

  revalidatePath("/dashboard/household");
  return {};
}

export async function deleteHouseholdAction(): Promise<ActionState> {
  const { household, role, households } = await requireHousehold();
  if (role !== "OWNER") {
    return { error: "Only the household owner can delete the household" };
  }
  if (households.length <= 1) {
    return { error: "You can't delete your only household. Create another one first." };
  }

  await prisma.household.delete({ where: { id: household.id } });

  const fallback = households.find((h) => h.id !== household.id);
  const cookieStore = await cookies();
  if (fallback) {
    cookieStore.set(ACTIVE_HOUSEHOLD_COOKIE, fallback.id, {
      maxAge: ACTIVE_HOUSEHOLD_COOKIE_MAX_AGE,
      path: "/",
    });
  }

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

// A CONTRIBUTOR leaving removes their own membership — mirrors
// removeMemberAction's shape but self-targeted, so there's no "target
// member id" to trust from the client at all. The owner can't use this:
// they must transferOwnershipAction or deleteHouseholdAction instead,
// since a household always needs exactly one OWNER.
export async function leaveHouseholdAction(): Promise<ActionState> {
  const { household, role, userId, households } = await requireHousehold();
  if (role === "OWNER") {
    return { error: "Transfer ownership to another member before leaving, or delete the household instead" };
  }
  if (households.length <= 1) {
    return { error: "You can't leave your only household. Create another one first." };
  }

  const membership = await prisma.householdMember.findUnique({
    where: { householdId_userId: { householdId: household.id, userId } },
  });
  if (!membership) return { error: "Membership not found" };

  await prisma.householdMember.delete({ where: { id: membership.id } });

  const fallback = households.find((h) => h.id !== household.id);
  const cookieStore = await cookies();
  if (fallback) {
    cookieStore.set(ACTIVE_HOUSEHOLD_COOKIE, fallback.id, {
      maxAge: ACTIVE_HOUSEHOLD_COOKIE_MAX_AGE,
      path: "/",
    });
  }

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

// Swaps OWNER/CONTRIBUTOR between the caller and the target member in a
// $transaction, same pattern as removeMemberAction/deleteHouseholdAction:
// re-derive both memberships from the session-scoped household rather than
// trusting anything but the target's id from the client.
export async function transferOwnershipAction(newOwnerMemberId: string): Promise<ActionState> {
  const { household, role, userId } = await requireHousehold();
  if (role !== "OWNER") {
    return { error: "Only the household owner can transfer ownership" };
  }

  const currentOwnerMembership = await prisma.householdMember.findUnique({
    where: { householdId_userId: { householdId: household.id, userId } },
  });
  if (!currentOwnerMembership) return { error: "Membership not found" };

  const target = await prisma.householdMember.findFirst({
    where: { id: newOwnerMemberId, householdId: household.id },
  });
  if (!target) return { error: "Member not found" };
  if (target.userId === userId) return { error: "You're already the owner" };
  if (target.role === "OWNER") return { error: "This member is already the owner" };

  await prisma.$transaction([
    prisma.householdMember.update({
      where: { id: currentOwnerMembership.id },
      data: { role: "CONTRIBUTOR" },
    }),
    prisma.householdMember.update({
      where: { id: target.id },
      data: { role: "OWNER" },
    }),
  ]);

  revalidatePath("/dashboard/household");
  return {};
}
