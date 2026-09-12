// Shared expiry-status predicate — mirrors src/lib/stock-status.ts's split
// for the same reason: the notification center (a Server Component/module)
// and the inventory table (a "use client" module) both need the exact same
// classification, and a Server Component can't safely import a plain
// function from a "use client" module.

export const EXPIRY_WARNING_DAYS = 3;

export type ExpiryStatus = "expired" | "soon" | null;

const DAY_MS = 24 * 60 * 60 * 1000;

export function getExpiryStatus(expiresAt: Date | null, now: number): ExpiryStatus {
  if (!expiresAt) return null;
  const daysUntil = (expiresAt.getTime() - now) / DAY_MS;
  if (daysUntil < 0) return "expired";
  if (daysUntil <= EXPIRY_WARNING_DAYS) return "soon";
  return null;
}
