"use server";

import { prisma } from "@/lib/prisma";
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
  const userId = await requireUserId();

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
