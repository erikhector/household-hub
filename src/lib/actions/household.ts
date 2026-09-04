"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { AuthError } from "next-auth";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { signIn } from "@/lib/auth";
import type { ActionState } from "@/lib/actions/auth";

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
