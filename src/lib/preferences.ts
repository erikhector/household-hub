import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Account-level UI preferences (theme, locale, inventory view). Cached per
// request the same way requireUserId/requireHousehold are (src/lib/session.ts)
// so the several call sites that each want one field (RootLayout for theme,
// getLocale() for locale, the inventory page for view prefs) share a single
// query instead of one each. Returns null for anonymous requests — callers
// fall back to their pre-existing cookie/hardcoded default in that case.
export const getUserPreferences = cache(async () => {
  // PERF-31: say "per request" before auth(), which can reach
  // crypto.getRandomValues() for a visitor with no session cookie. Next logs
  // that as an unstable value read while prerendering (Cache Components).
  await connection();
  const session = await auth();
  if (!session?.user?.id) return null;

  return prisma.user.findUnique({
    where: { id: session.user.id },
    select: { theme: true, locale: true, inventoryViewPrefs: true },
  });
});
