import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isSessionRevoked, SESSION_EXPIRED_PATH } from "@/lib/session-revocation";

export const ACTIVE_HOUSEHOLD_COOKIE = "active_household";

// For the personal budget (see AGENTS.md's "Personal hub" work): scoped to
// the signed-in user rather than any household, so unlike requireHousehold
// it doesn't need a membership at all.
//
// Wrapped in React's cache() so repeat calls within the same request (e.g.
// dashboard/layout.tsx and its page.tsx both calling this) reuse one result
// instead of re-querying the DB per call.
//
// Both guards also reject a session issued before the user's last password
// change (SCALE-H, see src/lib/session-revocation.ts). That's the one DB
// read this function does — a JWT alone can't know the password changed.
export const requireUserId = cache(async () => {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { passwordChangedAt: true },
  });
  if (isSessionRevoked(user, session.user.pwdChangedAt)) {
    redirect(SESSION_EXPIRED_PATH);
  }

  return session.user.id;
});

export const requireHousehold = cache(async () => {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  // One query for both the revocation check and the memberships, via the
  // User row, so SCALE-H adds no extra round trip to every dashboard
  // request.
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      passwordChangedAt: true,
      memberships: {
        include: { household: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!user || isSessionRevoked(user, session.user.pwdChangedAt)) {
    redirect(SESSION_EXPIRED_PATH);
  }

  const { memberships } = user;
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
