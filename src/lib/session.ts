import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const ACTIVE_HOUSEHOLD_COOKIE = "active_household";

// For the personal budget (see AGENTS.md's "Personal hub" work): scoped to
// the signed-in user rather than any household, so unlike requireHousehold
// it doesn't need a membership at all.
//
// Wrapped in React's cache() so repeat calls within the same request (e.g.
// dashboard/layout.tsx and its page.tsx both calling this) reuse one result
// instead of re-querying the DB per call.
export const requireUserId = cache(async () => {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  return session.user.id;
});

export const requireHousehold = cache(async () => {
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
});
