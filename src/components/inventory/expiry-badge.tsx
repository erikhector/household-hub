"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { getExpiryStatus } from "@/lib/inventory/expiry";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

export function ExpiryBadge({
  expiresAt,
  expiresAtEstimated = false,
  dict,
}: {
  expiresAt: Date | null;
  /** AUTO-7: true when `expiresAt` came from the shelf-life estimator
   * rather than a date the household typed in — shown with a "≈" prefix and
   * a softer (outline, not destructive/attention) style, so a guess never
   * reads as certain as a real best-before date. */
  expiresAtEstimated?: boolean;
  dict: Dictionary["inventory"];
}) {
  // Read once via a lazy initializer rather than calling Date.now() directly
  // in the render body — same pattern InventoryClient's `now` uses for
  // matchesUpdatedFilter.
  const [now] = useState(() => Date.now());
  const status = getExpiryStatus(expiresAt, now);
  if (!status) return null;
  const label = status === "expired" ? dict.expired : dict.expiringSoon;
  if (expiresAtEstimated) return <Badge variant="outline">≈ {label}</Badge>;
  if (status === "expired") return <Badge variant="destructive">{label}</Badge>;
  return <Badge variant="attention">{label}</Badge>;
}
