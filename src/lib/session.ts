import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const ACTIVE_HOUSEHOLD_COOKIE = "active_household";

// Where a signed-in user with zero HouseholdMember rows is sent. Deliberately
// outside /dashboard (whose layout calls requireHousehold, so it would loop)
// and not /login: proxy.ts bounces any request carrying a session away from
// /login back to /dashboard, which used to trap these users in an endless
// /dashboard → /login → /dashboard redirect. See REQUIREMENTS.md's
// "Users with no household".
export const NO_HOUSEHOLD_PATH = "/no-household";

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

// Guard for the NO_HOUSEHOLD_PATH page itself: signed-out visitors go to
// /login as usual, and anyone who does have a household (e.g. they just
// accepted an invite in another tab, or typed the URL) goes back to the
// dashboard instead of seeing a "you have no household" message that isn't
// true.
export async function requireUserWithoutHousehold() {
  const userId = await requireUserId();
  const membershipCount = await prisma.householdMember.count({ where: { userId } });
  if (membershipCount > 0) {
    redirect("/dashboard");
  }
  return userId;
}

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

  // Reachable in normal use: removeMemberAction doesn't (and can't
  // sensibly) check whether the removed contributor has another household.
  if (memberships.length === 0) {
    redirect(NO_HOUSEHOLD_PATH);
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
