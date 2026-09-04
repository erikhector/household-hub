import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const ACTIVE_HOUSEHOLD_COOKIE = "active_household";

export async function requireHousehold() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const memberships = await prisma.householdMember.findMany({
    where: { userId: session.user.id },
    include: { household: true },
    orderBy: { createdAt: "asc" },
  });

  if (memberships.length === 0) {
    redirect("/login");
  }

  const cookieStore = await cookies();
  const activeId = cookieStore.get(ACTIVE_HOUSEHOLD_COOKIE)?.value;
  const active = memberships.find((m) => m.householdId === activeId) ?? memberships[0];

  return {
    userId: session.user.id,
    household: active.household,
    role: active.role,
    households: memberships.map((m) => ({
      id: m.household.id,
      name: m.household.name,
      role: m.role,
    })),
  };
}
