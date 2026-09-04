"use server";

import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { AuthError } from "next-auth";
import { prisma } from "@/lib/prisma";
import { ACTIVE_HOUSEHOLD_COOKIE, requireHousehold } from "@/lib/session";
import { signIn } from "@/lib/auth";
import type { ActionState } from "@/lib/actions/auth";

const ACTIVE_HOUSEHOLD_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const INVITE_TTL_DAYS = 7;

export async function createInviteAction(): Promise<{ url?: string; error?: string }> {
  const { household } = await requireHousehold();

  const invitation = await prisma.invitation.create({
    data: {
      householdId: household.id,
      token: randomUUID(),
      expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
    },
  });

  revalidatePath("/dashboard/household");
  return { url: `/join/${invitation.token}` };
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
        data: { householdId: invitation.householdId, userId, role: "MEMBER" },
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
      data: { householdId: invitation.householdId, userId: user.id, role: "MEMBER" },
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
