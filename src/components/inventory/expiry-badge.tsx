"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { getExpiryStatus } from "@/lib/inventory/expiry";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

export function ExpiryBadge({
  expiresAt,
  expiresAtEstimated = false,
  openedAt = null,
  dict,
}: {
  expiresAt: Date | null;
  /** AUTO-7: true when `expiresAt` came from the shelf-life estimator
   * rather than a date the household typed in — shown with a "≈" prefix and
   * a softer (outline, not destructive/attention) style, so a guess never
   * reads as certain as a real best-before date. */
  expiresAtEstimated?: boolean;
  /** GAP-28: set once the pack's been marked opened. Shown as its own quiet
   * "Opened" tag whether or not the date is inside the warning window yet —
   * "this one's open, use it first" is worth seeing on its own, and it
   * explains why an opened item's (≈) date suddenly moved closer. */
  openedAt?: Date | null;
  dict: Dictionary["inventory"];
}) {
  // Read once via a lazy initializer rather than calling Date.now() directly
  // in the render body — same pattern InventoryClient's `now` uses for
  // matchesUpdatedFilter.
  const [now] = useState(() => Date.now());
  const status = getExpiryStatus(expiresAt, now);
  const openedTag = openedAt ? <Badge variant="outline">{dict.opened}</Badge> : null;
  if (!status) return openedTag;
  const label = status === "expired" ? dict.expired : dict.expiringSoon;
  let statusBadge;
  if (expiresAtEstimated) statusBadge = <Badge variant="outline">≈ {label}</Badge>;
  else if (status === "expired") statusBadge = <Badge variant="destructive">{label}</Badge>;
  else statusBadge = <Badge variant="attention">{label}</Badge>;
  return (
    <>
      {openedTag}
      {statusBadge}
    </>
  );
}
