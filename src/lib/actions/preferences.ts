"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireUserId } from "@/lib/session";
import { logger } from "@/lib/logger";
import { isThemeChoice, type ThemeChoice } from "@/components/theme/theme-choice";
import type { InventoryViewPrefs } from "@/components/inventory/inventory-table-utils";

// Both actions below are fire-and-forget persistence from already-authoritative
// client state (next-themes' own store, InventoryClient's local useState) —
// there's no form/dialog waiting on a result, so failures are logged rather
// than surfaced as a user-facing error: losing a preference write just means
// the next device sees the previous value, not a broken session.

export async function setThemeAction(theme: ThemeChoice) {
  if (!isThemeChoice(theme)) return;
  // UX-51: logged-out pages have a theme toggle too, and its choice lives in
  // the browser alone. requireUserId() would redirect such a visitor to
  // /login (away from /join, say), so an anonymous call is a no-op instead,
  // like setLocaleAction's.
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return;

  try {
    await prisma.user.update({ where: { id: userId }, data: { theme } });
  } catch (error) {
    logger.error("Failed to persist theme preference", { error });
  }
}

export async function setInventoryViewPrefsAction(prefs: InventoryViewPrefs) {
  const userId = await requireUserId();

  try {
    await prisma.user.update({
      where: { id: userId },
      data: { inventoryViewPrefs: prefs },
    });
  } catch (error) {
    logger.error("Failed to persist inventory view preferences", { error });
  }
}
