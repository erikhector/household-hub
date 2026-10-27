"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/session";
import type { ActionState } from "@/lib/actions/auth";
import { fail, toFriendlyError } from "@/lib/actions/errors";
import { unsubscribeFromDigestByToken } from "@/lib/digest-unsubscribe";

// GAP-27: the weekly digest opt-in. Per user, not per household — it's the
// recipient's own inbox being signed up — so it only needs the session's
// user id, never a household id. A click action (a checkbox on the Profile
// page), so it takes the value directly rather than FormData.
export async function setWeeklyDigestEnabledAction(enabled: boolean): Promise<ActionState> {
  const userId = await requireUserId();

  if (typeof enabled !== "boolean") return await fail("invalidInput");

  try {
    await prisma.user.update({ where: { id: userId }, data: { weeklyDigestEnabled: enabled } });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/profile");
  return {};
}

export type DigestUnsubscribeState = { status?: "unsubscribed" | "invalid" | "error" };

// The /unsubscribe/[token] page's form action. Deliberately needs no
// session: the signed token is the authorization (see
// src/lib/digest-unsubscribe-token.ts), so someone reading the email on a
// device where they aren't signed in can still opt out in one step.
export async function unsubscribeFromDigestAction(
  _prevState: DigestUnsubscribeState,
  formData: FormData,
): Promise<DigestUnsubscribeState> {
  try {
    return { status: await unsubscribeFromDigestByToken(formData.get("token")) };
  } catch (error) {
    toFriendlyError(error);
    return { status: "error" };
  }
}
