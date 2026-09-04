import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function requireHousehold() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const membership = await prisma.householdMember.findFirst({
    where: { userId: session.user.id },
    include: { household: true },
    orderBy: { createdAt: "asc" },
  });

  if (!membership) {
    redirect("/login");
  }

  return {
    userId: session.user.id,
    household: membership.household,
    role: membership.role,
  };
}
