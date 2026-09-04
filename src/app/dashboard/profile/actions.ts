"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
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
